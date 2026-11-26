import { defineConfig } from 'vitest/config';
// The cloud tests boot a full Postgres (PGlite) per test; on CI runners with several test files in parallel that
// takes longer than vitest's default 5 s, so they timed out on main (26 Nov 2026).
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 30_000 } });
