/** File links stay on the conversation's host; web links keep their normal destination. */
export function chatPreviewPath(href: string): string | undefined {
  if (!href || /[\0\r\n]/.test(href) || href.startsWith("//")) return;
  let file = href.split(/[?#]/, 1)[0];
  if (file.startsWith("file:")) {
    try {
      const url = new URL(file);
      if (url.hostname && url.hostname !== "localhost") return;
      file = url.pathname;
    } catch {
      return;
    }
  } else if (/^[a-z][\w+.-]*:/i.test(file)) return;
  try {
    file = decodeURIComponent(file);
  } catch {
    return;
  }
  if (/[\0\r\n]/.test(file) || !/\.(pdf|html?)$/i.test(file)) return;
  return file;
}
export interface ChatFilePreview {
  path: string;
  kind: "pdf" | "html";
  size: number;
  url: string;
}
