import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/build/**",
      "**/.build/**",
      "**/release/**",
      "**/coverage/**",
      "**/.wrangler/**",
      "**/*.d.ts",
      "apps/desktop/resources/**",
      "dist/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "no-console": "off",
      "prefer-const": "error",
      "no-var": "error",
      "eqeqeq": ["error", "always"]
    }
  },
  {
    files: ["apps/desktop/src/renderer/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  },
  {
    files: ["apps/chromium-extension/src/**/*.ts"],
    languageOptions: { globals: { ...globals.browser, chrome: "readonly" } }
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] }
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { globals: { ...globals.node }, sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" }
  },
  {
    files: ["scripts/**/*.mjs", "**/*.config.{js,mjs,ts}"],
    languageOptions: { globals: { ...globals.node } }
  }
);
