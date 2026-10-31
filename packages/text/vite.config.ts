import { defineConfig } from "vite";

/**
 * Library build. The entry points mirror the package's `exports` map;
 * everything bare is external (peers and dependencies ship from npm), except the `?url&no-inline` font asset imports, which Vite emits as files under `dist/assets/`.
 * Types are emitted separately by `tsc -p tsconfig.build.json`.
 */
export default defineConfig({
	// Relative asset URLs, resolved against the module that references them.
	base: "./",
	build: {
		lib: {
			entry: {
				index: "src/index.ts",
				"entries/definitions": "src/entries/definitions.ts",
			},
			formats: ["es"],
		},
		rollupOptions: {
			output: { assetFileNames: "assets/[name][extname]" },
			external: (id) =>
				!id.includes("?url") && !id.startsWith(".") && !id.startsWith("/"),
		},
	},
});
