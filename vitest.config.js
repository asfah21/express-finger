import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
