import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/.astro/**",
      "**/.output/**",
      "**/.tanstack/**",
      "**/.wrangler/**",
      "**/dist/**",
      "**/drizzle/**",
      "**/node_modules/**",
      "**/routeTree.gen.ts",
      "**/auth.generated.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
