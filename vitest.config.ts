import { defineConfig } from 'vitest/config';
// The PGlite cloud-schema and sync tests start a whole Postgres each; on a busy CI runner that can pass 5 s.
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 30_000 } });
