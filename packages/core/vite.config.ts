import { defineConfig } from "vite";

/**
 * Library build. The entry points mirror the package's `exports` map;
 * everything bare is external (peers and dependencies ship from npm).
 * Types are emitted separately by `tsc -p tsconfig.build.json`.
 */
export default defineConfig({
	build: {
		lib: {
			entry: {
				index: "src/index.ts",
				"entries/geometry": "src/entries/geometry.ts",
				"entries/color": "src/entries/color.ts",
				"entries/themes": "src/entries/themes.ts",
				"entries/internal": "src/entries/internal.ts",
				"entries/definitions": "src/entries/definitions.ts",
			},
			formats: ["es"],
		},
		rollupOptions: {
			external: (id) => !id.startsWith(".") && !id.startsWith("/"),
		},
	},
});
