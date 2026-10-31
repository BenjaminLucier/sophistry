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
				"math/index": "src/math/index.ts",
				"3d/index": "src/3d/index.ts",
				"3d/definitions": "src/3d/definitions.ts",
				"entries/definitions": "src/entries/definitions.ts",
			},
			formats: ["es"],
		},
		rollupOptions: {
			external: (id) => !id.startsWith(".") && !id.startsWith("/"),
		},
	},
});
