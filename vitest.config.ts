import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/effects.ts', 'src/lib/inverted-corners.ts'],
    },
    // Mock import.meta.env for tests
    env: {
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
  resolve: {
    alias: {
      '@lib': '/src/lib',
    },
  },
});
