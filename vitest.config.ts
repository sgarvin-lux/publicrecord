import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    include: ["scripts/**/__tests__/**/*.test.ts"],
    passWithNoTests: true,
    env: { NODE_ENV: "test" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
