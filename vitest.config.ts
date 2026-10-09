import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    maxWorkers: 4,
    environment: "jsdom",
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
