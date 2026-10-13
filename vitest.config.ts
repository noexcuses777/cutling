import {defineConfig} from 'vitest/config';
import path from 'node:path';
export default defineConfig({resolve:{alias:{'server-only':path.resolve('tests/server-only.ts')}},test:{include:['tests/**/*.test.ts','packages/*/{test,tests}/*.test.ts','apps/extension/tests/*.test.ts'],exclude:['**/node_modules/**','**/dist/**','tests/e2e/**'],testTimeout:20000}});
