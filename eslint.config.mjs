import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", "graphify-out/**", "drizzle/**", ".next/**", "test-results/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
);
