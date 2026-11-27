import { build } from 'vite';
import react from '@vitejs/plugin-react';
for (const [source, destination] of [['renderer', 'renderer'], ['renderer-chatgpt', 'renderer-chatgpt']]) {
  await build({ configFile: false, root: `src/${source}`, base: './', plugins: [react()], build: { outDir: `../../out/${destination}`, emptyOutDir: true, chunkSizeWarningLimit: 1600 } });
}
