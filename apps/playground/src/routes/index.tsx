import { Title } from "@solidjs/meta";
import { For } from "solid-js";

/** The playground demos. */
const DEMOS = [
	{
		href: "/shapes",
		title: "Shapes and tweens",
		blurb: "A circle drawn with draw(), then a dot orbiting it with moveTo().",
	},
	{
		href: "/bars",
		title: "Bar chart",
		blurb: "A BarChart from sophistry/charts revealed with a progress track.",
	},
	{
		href: "/math",
		title: "LaTeX as geometry",
		blurb: "MathTex turns KaTeX output into scene geometry you can animate.",
	},
	{
		href: "/orbit",
		title: "3D orbit",
		blurb: "A Camera3D with OrbitControls3D — drag to spin the scene.",
	},
	{
		href: "/line-plot",
		title: "Line plot",
		blurb: "LinePlot inside Axes: literal data drawn in data coordinates.",
	},
	{
		href: "/pie",
		title: "Pie chart",
		blurb: "PieChart with per-slice labels, revealed as one shape.",
	},
	{
		href: "/chart-motion",
		title: "Chart motion",
		blurb:
			"Clipping, one reveal front across layers, an animated domain and radial sweeps.",
	},
	{
		href: "/drag",
		title: "Draggable",
		blurb:
			"Three dots, three constraints: free, pinned to a circle, snapped to a grid.",
	},
	{
		href: "/calculus",
		title: "Calculus on a graph",
		blurb:
			"Area under a curve, Riemann rectangles piling up, and a secant walking into a tangent.",
	},
	{
		href: "/linear",
		title: "Linear transform",
		blurb:
			"A shear warps the grid, a dot rides along, and the basis arrows report the map.",
	},
	{
		href: "/numbers",
		title: "Animated numbers",
		blurb:
			"Integer and Variable tick via valueTo — columns held open so nothing shimmers.",
	},
	{
		href: "/pan-zoom",
		title: "Pan & zoom",
		blurb:
			"Wheel to zoom (pinned to the cursor), drag to pan — the camera cells are ordinary tracks.",
	},
	{
		href: "/morph",
		title: "Morph",
		blurb:
			"morph() interpolates a polyline track between circle, square and star.",
	},
	{
		href: "/views",
		title: "Multi-camera views",
		blurb:
			"One scene through a PictureInPicture inset that tracks a moving dot.",
	},
	{
		href: "/latex-morph",
		title: "LaTeX morph",
		blurb:
			"MathTransform carries every shared glyph from one formula to the next.",
	},
] as const;

export default function Index() {
	return (
		<>
			<Title>sophistry playground</Title>
			<p class="text-sm text-muted">
				Demos of @sophistry/core and its Solid bindings.
			</p>
			<div class="grid gap-4 sm:grid-cols-2">
				<For each={DEMOS}>
					{(demo) => (
						<a
							href={demo.href}
							class="rounded-xl border border-rule p-4 transition-colors hover:bg-surface"
						>
							<h2 class="font-semibold text-ink">{demo.title}</h2>
							<p class="mt-1 text-sm text-muted">{demo.blurb}</p>
						</a>
					)}
				</For>
			</div>
		</>
	);
}
