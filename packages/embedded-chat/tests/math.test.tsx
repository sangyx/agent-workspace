import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ChatMarkdown } from "../src/ChatMarkdown";
it("renders the same inline and display math in embedded/fallback Chat without changing code or links", () => {
  const html = renderToStaticMarkup(
    createElement(ChatMarkdown, {
      children: String.raw`Inline \(x_i^2\), $\alpha$, and:
\[\frac{1}{n}\sum_{i=1}^{n}x_i\]

[PDF](paper.pdf) and \`$literal$\`.`.replaceAll("\\`", "`"),
    }),
  );
  expect(html.match(/class="katex"/g) ?? []).toHaveLength(3);
  expect(html).toContain('class="katex-display"');
  expect(html).toContain("<code>$literal$</code>");
  expect(html).toContain('href="paper.pdf"');
});
