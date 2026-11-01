import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import solid2 from "./src/integrations/solid2/index.ts";

// Starlight keeps its light/dark choice on `<html data-theme>`; sophistry's
// <Stage> follows `<html data-mode>`. This blocking script mirrors the former
// onto the latter, before first paint and on every later toggle, so the
// visualizations always match the page.
const syncMode = `(function(){var d=document.documentElement;function s(){d.dataset.mode=d.dataset.theme==="light"?"light":"dark"}s();new MutationObserver(s).observe(d,{attributes:true,attributeFilter:["data-theme"]})})();`;

// Served from the custom domain sophistry.dev (see public/CNAME), so no `base`.
export default defineConfig({
	site: "https://sophistry.dev",
	redirects: {
		"/guides/getting-started": "/start/first-scene/",
	},
	integrations: [
		starlight({
			title: "sophistry",
			description:
				"Controllable Manim-for-the-web: a framework-free animation and visualization core, with SolidJS and React bindings, painted on Canvas2D.",
			logo: {
				light: "./public/logo-light.svg",
				dark: "./public/logo-dark.svg",
				alt: "",
			},
			favicon: "/favicon.svg",
			// KaTeX's stylesheet lays out every formula @sophistry/text typesets.
			customCss: ["./src/styles/theme.css", "katex/dist/katex.css"],
			components: {
				Hero: "./src/components/Hero.astro",
				Banner: "./src/components/Banner.astro",
			},
			head: [
				{ tag: "script", content: syncMode },
				{
					tag: "meta",
					attrs: {
						property: "og:image",
						content: "https://sophistry.dev/og.png",
					},
				},
				{ tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
				{ tag: "meta", attrs: { property: "og:image:height", content: "630" } },
				{
					tag: "meta",
					attrs: {
						property: "og:image:alt",
						content:
							"sophistry: controllable Manim-for-the-web, with a purple epicycle mark.",
					},
				},
				{
					tag: "meta",
					attrs: { name: "twitter:card", content: "summary_large_image" },
				},
				{
					tag: "meta",
					attrs: {
						name: "twitter:image",
						content: "https://sophistry.dev/og.png",
					},
				},
				{ tag: "meta", attrs: { name: "theme-color", content: "#1e1e2e" } },
			],
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/BenjaminLucier/sophistry",
				},
			],
			sidebar: [
				{
					label: "Start",
					items: [
						"start/why",
						"start/installation",
						"start/first-scene",
						"start/concepts",
					],
				},
				{
					label: "Essentials",
					items: [
						"guides/shapes-and-styling",
						"guides/layout",
						"guides/animation",
						"guides/animation-presets",
						"guides/timelines",
						"guides/interaction",
						"guides/instancing",
					],
				},
				{
					label: "Plotting",
					items: [
						"guides/coordinate-systems",
						"guides/fields-and-graphs",
						"guides/charts",
						"guides/chart-animation",
					],
				},
				{
					label: "More guides",
					items: [
						"guides/math-and-latex",
						"guides/cameras",
						"guides/3d",
						"guides/theming-and-color",
						"guides/accessibility",
						"guides/extending",
						"guides/bindings",
					],
				},
				{
					label: "Recipes",
					items: [
						"recipes/scrub-slider",
						"recipes/scroll-driven",
						"recipes/algorithm-visualizer",
						"recipes/step-through-lesson",
						"recipes/embedding",
						"recipes/export-stills",
					],
				},
				{ label: "Coming from Manim", items: ["manim/migration"] },
				{
					label: "Gallery",
					items: [
						{ label: "Overview", slug: "gallery" },
						"gallery/basic",
						{
							label: "Animations",
							collapsed: true,
							items: [
								{ label: "Overview", slug: "gallery/animation" },
								"gallery/animation/tweens-and-effects",
								"gallery/animation/sequencing-and-timelines",
							],
						},
						{
							label: "Plotting and charts",
							collapsed: true,
							items: [
								{ label: "Overview", slug: "gallery/plotting" },
								"gallery/plotting/function-graphs",
								"gallery/plotting/bars-and-parts",
								"gallery/plotting/lines-and-areas",
								"gallery/plotting/scatter-and-distributions",
								"gallery/plotting/facets-and-linked-views",
								"gallery/plotting/heatmaps-and-contours",
								"gallery/plotting/hierarchies-and-networks",
								"gallery/plotting/chart-transitions",
							],
						},
						{
							label: "Interaction",
							collapsed: true,
							items: [
								{ label: "Overview", slug: "gallery/interaction" },
								"gallery/interaction/dragging-and-input",
								"gallery/interaction/cameras-and-zoom",
							],
						},
						"gallery/maths",
						"gallery/three-d",
						"gallery/advanced",
						"gallery/vanilla",
					],
				},
				{
					label: "Reference",
					items: ["reference/api", "reference/chart-catalogue"],
				},
				{
					label: "Project",
					items: [
						"project/architecture",
						"project/performance",
						"project/stability",
						"project/roadmap",
						"project/changelog",
					],
				},
			],
		}),
		// `ssr: true` compiles the server bundle with SSR codegen (no DOM calls at
		// module scope) and the client with hydratable code, which renders fresh
		// when there are no hydration markers — exactly what `client:only` islands
		// need. Without it, client-codegen `template()` calls throw during prerender.
		solid2({ ssr: true }),
	],
	vite: {
		resolve: {
			// One copy of Solid across the library, the islands and the docs.
			dedupe: ["solid-js", "@solidjs/web"],
		},
	},
});
