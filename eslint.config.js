import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(
    ["dist/", ".cache/source-inputs/", "artifacts/releases/", "coverage/"],
    "Generated and downloaded content",
  ),
  {
    files: ["**/*.{js,cjs,mjs}"],
    extends: [js.configs.recommended],
  },
  {
    files: ["**/*.{ts,cts,mts}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
