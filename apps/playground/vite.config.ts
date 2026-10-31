import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { fileRoutes } from "filesystem-routing/vite";
import { defineConfig, type Plugin } from "vite";
// By relative path: Node loads a config's workspace deps directly, and the
// package ships TypeScript source; Vite's config bundler inlines this import.
import {
	paletteCss,
	resolvePalette,
	themeInitScript,
} from "../../packages/core/src/themes";

/**
 * Injects the page-level theme from the sophistry palette, so no hex lives in
 * this app: the blocking pre-paint script (sets `data-mode` before first
 * paint, no flash), the palette's CSS variables, and `theme-color`.
 */
function sophistryTheme(): Plugin {
	return {
		name: "sophistry-theme",
		transformIndexHtml: () => [
			{
				tag: "meta",
				attrs: {
					name: "theme-color",
					content: resolvePalette().dark.background,
				},
				injectTo: "head",
			},
			{
				tag: "script",
				children: themeInitScript(),
				injectTo: "head",
			},
			{ tag: "style", children: paletteCss(), injectTo: "head" },
		],
	};
}

export default defineConfig({
	// Non-standard port so the dev server doesn't clash with other projects.
	server: { port: 5199, strictPort: true },
	preview: { port: 5199, strictPort: true },
	plugins: [
		sophistryTheme(),
		// `extensions` makes the solid plugin also compile the `?pick=` route
		// modules filesystem-routing emits (their ids end in a query string).
		solid({ extensions: [".jsx", ".tsx"] }),
		fileRoutes(),
		tailwindcss(),
	],
	resolve: {
		// One copy of Solid, shared by the app and the library it links.
		dedupe: ["solid-js", "@solidjs/web"],
	},
});
