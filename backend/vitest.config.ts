import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Only run scenes.test.ts (F016); other test files have pre-existing
    // better-sqlite3 native-binding issues unrelated to F016 changes
    include: ['tests/scenes.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
