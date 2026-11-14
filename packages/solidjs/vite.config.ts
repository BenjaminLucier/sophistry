import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

/**
 * Library build. The entry points mirror the package's `exports` map;
 * everything bare is external (peers and dependencies ship from npm).
 * Types are emitted separately by `tsc -p tsconfig.build.json`.
 */
export default defineConfig({
	plugins: [solid()],
	build: {
		lib: {
			entry: {
				index: "src/index.ts",
				"entries/text": "src/entries/text.ts",
				"entries/box": "src/entries/box.ts",
				"entries/charts": "src/entries/charts.ts",
				"entries/charts3d": "src/entries/charts3d.ts",
				"entries/3d": "src/entries/3d.ts",
			},
			formats: ["es"],
		},
		rollupOptions: {
			external: (id) => !id.startsWith(".") && !id.startsWith("/"),
		},
	},
});
