import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // NOTE: test files that use better-sqlite3 (rooms.test.ts, stateMachine.test.ts,
    // rooms.http.test.ts) require the native binding to be compiled:
    //   cd backend && pnpm rebuild better-sqlite3
    // If the binding is missing those files will fail to load; scenes.test.ts
    // runs standalone without needing the DB binding.
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
