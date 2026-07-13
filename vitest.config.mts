import { defineConfig } from "vitest/config";

// https://vitest.dev/config/
export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },
});
