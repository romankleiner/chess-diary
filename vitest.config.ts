import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    setupFiles: ['__tests__/helpers/mock-clerk.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'app/api/**'],
      exclude: ['lib/stockfish.ts'],
    },
    // Prevent the Stockfish WASM/native module from being loaded during tests
    server: {
      deps: {
        external: ['@se-oss/stockfish'],
      },
    },
  },
});
