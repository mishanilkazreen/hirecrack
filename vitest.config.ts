import { defineConfig } from 'vitest/config';

// Two projects so `pnpm test` runs everything:
//  - unit: plain TypeScript modules, node environment (*.test.ts)
//  - integration: React Testing Library against the real app, jsdom (*.test.tsx)
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/setup.ts'],
          restoreMocks: true,
        },
      },
    ],
  },
});
