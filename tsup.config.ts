import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'engine/index': 'src/engine/index.ts',
    'schema/index': 'src/schema/index.ts',
    'presets/index': 'src/presets/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node20',
  splitting: false,
  sourcemap: true,
});
