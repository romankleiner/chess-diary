import { defineConfig, configDefaults } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    // .claude/worktrees holds full checkouts of other branches. Without this,
    // vitest discovers their copies of the suite and runs them (against old
    // code) alongside the real tests, inflating counts and adding failures.
    exclude: [...configDefaults.exclude, '.claude/**'],
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
