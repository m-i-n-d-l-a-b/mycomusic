import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts", "server/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["server/**/*.ts", "src/**/*.ts", "src/**/*.tsx"],
      exclude: ["server/index.ts", "**/*.d.ts"],
    },
  },
});
