import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import rehypeKatex from "rehype-katex";
import { unified, type PluggableList } from "unified";

type Node = {
  type: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hProperties?: { className?: string[] } };
};
const parser = unified().use(remarkParse).use(remarkMath);
const protectedKinds = new Set([
  "code",
  "inlineCode",
  "math",
  "inlineMath",
  "html",
  "link",
  "image",
  "definition",
]);
const escaped = (source: string, at: number) => {
  let count = 0;
  while (at > 0 && source[--at] === "\\") count++;
  return count % 2 === 1;
};

/** Normalize model-style TeX delimiters for remark-math, only in Markdown prose. */
export function normalizeMathMarkdown(source: string): string {
  if (!/\\[([]/.test(source)) return source;
  const ranges: [number, number][] = [];
  const walk = (node: Node) => {
    const start = node.position?.start.offset,
      end = node.position?.end.offset;
    if (
      protectedKinds.has(node.type) &&
      start !== undefined &&
      end !== undefined
    )
      ranges.push([start, end]);
    else for (const child of node.children ?? []) walk(child);
  };
  walk(parser.parse(source) as Node);
  const normalize = (text: string, offset: number) => {
    let out = "",
      copied = 0;
    for (let at = 0; at < text.length - 1; at++) {
      if (
        text[at] !== "\\" ||
        escaped(text, at) ||
        !["(", "["].includes(text[at + 1])
      )
        continue;
      const display = text[at + 1] === "[",
        endMark = display ? "\\]" : "\\)";
      let end = text.indexOf(endMark, at + 2);
      while (end >= 0 && escaped(text, end))
        end = text.indexOf(endMark, end + 2);
      if (end < 0) continue; // An unfinished streamed delimiter stays readable source.
      let body = text.slice(at + 2, end);
      if (!body.trim()) continue;
      const dollarRuns = body.match(/\$+/g) ?? [];
      const fence = "$".repeat(
        Math.max(
          display ? 2 : dollarRuns.length ? 3 : 1,
          ...dollarRuns.map((run) => run.length + 1),
        ),
      );
      out += text.slice(copied, at);
      if (display) {
        const absolute = offset + at;
        const before = source.slice(
          source.lastIndexOf("\n", absolute - 1) + 1,
          absolute,
        );
        // Retain blockquote/list continuation indentation when expanding a one-line display.
        const container =
          /^([ \t]*(?:>[ \t]*)*)(?:([-+*]|\d+[.)])([ \t]+))?$/.exec(before);
        const prefix = container
          ? container[1] +
            (container[2]
              ? " ".repeat(container[2].length + container[3].length)
              : "")
          : "";
        body = body
          .split("\n")
          .map((line) =>
            prefix && line.startsWith(prefix)
              ? line.slice(prefix.length)
              : line,
          )
          .join("\n")
          .trim();
        const tail = source.slice(
          offset + end + 2,
          source.indexOf("\n", offset + end + 2) < 0
            ? undefined
            : source.indexOf("\n", offset + end + 2),
        );
        out +=
          (container ? "" : "\n\n") +
          fence +
          "\n" +
          body
            .split("\n")
            .map((line) => prefix + line)
            .join("\n") +
          "\n" +
          prefix +
          fence +
          (tail.trim() ? "\n\n" : "");
      } else out += fence + body + fence;
      at = end + 1;
      copied = end + 2;
    }
    return out + text.slice(copied);
  };
  let out = "",
    copied = 0;
  for (const [start, end] of ranges) {
    out +=
      normalize(source.slice(copied, start), copied) + source.slice(start, end);
    copied = end;
  }
  return out + normalize(source.slice(copied), copied);
}

/** Keep currency literal; double-dollar inline syntax is displayed as an equation too. */
function remarkMathPresentation() {
  return (tree: Node, file: { value: unknown }) => {
    const source = String(file.value);
    const walk = (node: Node) => {
      if (node.type === "inlineMath") {
        const start = node.position?.start.offset,
          end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) {
          const raw = source.slice(start, end);
          if (/^\$\$[^$]/.test(raw))
            node.data = {
              ...node.data,
              hProperties: { className: ["language-math", "math-display"] },
            };
          else if (/^\$\d/.test(raw) && /^\d/.test(source.slice(end))) {
            node.type = "text";
            node.value = raw;
            delete node.data;
          }
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

export const mathRemarkPlugins: PluggableList = [
  remarkMath,
  remarkMathPresentation,
];
// TeX cannot load remote URLs/HTML; runaway macro expansion and layout size are capped.
export const mathRehypePlugins: PluggableList = [
  [
    rehypeKatex,
    { trust: false, strict: "ignore", maxExpand: 1000, maxSize: 12 },
  ],
];
