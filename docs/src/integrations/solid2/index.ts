import { fileURLToPath } from "node:url";
import solid from "@solidjs/vite-plugin";
import type { AstroIntegration } from "astro";

/**
 * A Solid 2 renderer for Astro islands.
 *
 * `@astrojs/solid-js` still targets Solid 1: its client entry imports
 * `render`/`hydrate` from `solid-js/web`, which no longer exists in the 2.0
 * line (the DOM renderer moved to `@solidjs/web`), and `Suspense` is gone.
 * This integration registers the same renderer shape with a client entry
 * written against Solid 2's module layout, and compiles island JSX with the
 * same `@solidjs/vite-plugin` the playground uses — one Solid transform across
 * the workspace.
 *
 * Islands are `client:only="solid2"`: the canvas needs the DOM anyway, and
 * this keeps the (unwired) SSR path of the renderer out of the picture.
 */
export default function solid2(
	options: { ssr?: boolean } = {},
): AstroIntegration {
	return {
		name: "@sophistry/solid2",
		hooks: {
			"astro:config:setup": ({ addRenderer, updateConfig }) => {
				addRenderer({
					name: "@sophistry/solid2",
					clientEntrypoint: fileURLToPath(
						new URL("./client.js", import.meta.url),
					),
					serverEntrypoint: fileURLToPath(
						new URL("./server.js", import.meta.url),
					),
				});
				updateConfig({
					vite: {
						plugins: [solid({ ssr: options.ssr })],
						resolve: {
							// One copy of Solid across the library, the islands and the docs.
							dedupe: ["solid-js", "@solidjs/web"],
						},
					},
				});
			},
		},
	};
}
