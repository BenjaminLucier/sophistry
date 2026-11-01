import { createDrillDown } from "@sophistry/charts";
import { Stage, useScene } from "@sophistry/solidjs";
import { Breadcrumbs, CirclePack } from "@sophistry/solidjs/charts";

export const meta = {
	title: "Zoomable circle packing",
	description:
		"Tap a circle to zoom into it and the background to zoom out, along d3's smooth zoom path. The chart is controlled: createDrillDown holds the focus and tweens it, and the same focus drives the breadcrumb trail, so both scrub together.",
};

type Item = { name: string; n?: number; children?: Item[] };
const leaves = (...entries: [string, number][]) =>
	entries.map(([name, n]) => ({ name, n }));

const life: Item = {
	name: "life",
	children: [
		{
			name: "animals",
			children: [
				{
					name: "birds",
					children: leaves(["owl", 4], ["wren", 2], ["heron", 3]),
				},
				{ name: "fish", children: leaves(["cod", 3], ["eel", 2]) },
				{
					name: "insects",
					children: leaves(["bee", 5], ["ant", 6], ["moth", 2]),
				},
			],
		},
		{
			name: "plants",
			children: [
				{ name: "trees", children: leaves(["oak", 4], ["fir", 3]) },
				{ name: "ferns", n: 3 },
			],
		},
		{ name: "fungi", children: leaves(["yeast", 2], ["mould", 3]) },
	],
};

/** Inside the stage, so the zoom runs on its clock and reduced-motion policy. */
function Zoomable() {
	const scene = useScene();
	const zoom = createDrillDown({
		duration: 0.9,
		clock: scene.clock,
		reducedMotion: scene.reducedMotion,
	});
	return (
		<>
			<Breadcrumbs
				path={zoom.focus}
				root="life"
				y={2.45}
				align="center"
				onSelect={zoom.zoomTo}
			/>
			<CirclePack
				data={life}
				value="n"
				label="name"
				radius={2.15}
				center={{ x: 0, y: -0.25 }}
				labelFontSize={0.17}
				focus={zoom.focus}
				onFocusChange={zoom.zoomTo}
				tooltip
			/>
		</>
	);
}

export default function ZoomableCirclePack() {
	return (
		<Stage units={10}>
			<Zoomable />
		</Stage>
	);
}
