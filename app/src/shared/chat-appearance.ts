import { z } from "zod";
export const maxChatStyleBytes = 128 * 1024;
export const chatStyleSchema = z.object({
  name: z.string().min(1).max(200),
  css: z
    .string()
    .max(maxChatStyleBytes)
    .refine(
      (css) =>
        !css.includes("\0") &&
        new TextEncoder().encode(css).length <= maxChatStyleBytes,
      "Choose a CSS text file smaller than 128 KB.",
    ),
  enabled: z.boolean(),
});
export const chatAppearanceSchema = z.object({
  interfaceStyle: z.enum(["claude", "chatgpt"]),
  customStyle: chatStyleSchema.nullable().optional(),
});
export type ChatAppearance = z.infer<typeof chatAppearanceSchema>;
export type ChatStyle = z.infer<typeof chatStyleSchema>;
export function importChatStyle(name: string, css: string): ChatStyle {
  if (!/\.css$/i.test(name)) throw new Error("Choose a .css style file.");
  if (!css.trim()) throw new Error("The CSS file is empty.");
  return chatStyleSchema.parse({ name, css, enabled: true });
}
export const activeChatCSS = (style?: ChatStyle | null): string =>
  style?.enabled ? style.css : "";
