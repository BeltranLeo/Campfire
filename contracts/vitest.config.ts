import { defineConfig } from 'vitest/config';

// The CashScript matchers extend the global `expect`, so globals must be enabled.
export default defineConfig({ test: { globals: true } });
