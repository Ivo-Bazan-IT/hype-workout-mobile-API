import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // La primera arranque de mongodb-memory-server puede descargar el binario de mongod;
    // damos margen para que el beforeAll global no expire.
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.ts',
      ]
    },
    setupFiles: ['./tests/setup.ts']
  }
});