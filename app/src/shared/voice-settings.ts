import { z } from 'zod';
export const recognitionSchema = z.object({
  language: z.enum(['auto', 'en', 'zh', 'mixed']).default('auto'),
  vocabulary: z.string().max(4000).default(''),
});
export const liveVoiceSchema = z.object({
  model: z.enum(['gpt-live-1.1', 'gpt-live-1']).default('gpt-live-1.1'),
  voice: z.enum(['marin', 'quartz', 'meridian']).default('marin'),
});
export type RecognitionSettings = z.infer<typeof recognitionSchema>;
export type LiveVoiceSettings = z.infer<typeof liveVoiceSchema>;
export function vocabularyWords(value = ''): string[] {
  return [
    ...new Set(
      value
        .split(/[,，;；\n]/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ]
    .slice(0, 50)
    .map((x) => x.slice(0, 80));
}
