import { defineConfig } from "vite";

/**
 * Library build: one entry, no dependencies to keep external. Types are
 * emitted separately by `tsc -p tsconfig.build.json`.
 */
export default defineConfig({
	build: {
		lib: {
			entry: { index: "src/index.ts" },
			formats: ["es"],
		},
	},
});
