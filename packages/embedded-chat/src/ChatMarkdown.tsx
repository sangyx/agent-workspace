import {
  normalizeMathMarkdown,
  mathRemarkPlugins,
  mathRehypePlugins,
} from "./math";
import "katex/dist/katex.min.css";
import "./math.css";
import { chatPreviewPath } from "./chatPreview";
import { memo, createContext, useContext, useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
export const ChatPreviewContext = createContext<
  ((href: string) => void) | null
>(null);
import remarkGfm from "remark-gfm";

// A draft or selection change must not reparse unchanged conversation history.
export const ChatMarkdown = memo(function ChatMarkdown({
  children,
}: {
  children: string;
}) {
  const preview = useContext(ChatPreviewContext);
  const markdown = useMemo(() => normalizeMathMarkdown(children), [children]);
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[...mathRemarkPlugins, remarkGfm]}
        rehypePlugins={mathRehypePlugins}
        urlTransform={(url) =>
          preview && chatPreviewPath(url) ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children }) => {
            const local = href && preview && chatPreviewPath(href);
            return (
              <a
                href={href}
                target={local ? undefined : "_blank"}
                rel="noopener noreferrer"
                onClick={
                  local
                    ? (e) => {
                        e.preventDefault();
                        preview!(href!);
                      }
                    : undefined
                }
              >
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
});
