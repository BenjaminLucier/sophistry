import type { SceneNode } from "@sophistry/core";
import { coordsOf, ORIGIN } from "@sophistry/core";
import {
	Axes,
	DashedLine,
	FunctionGraph,
	LabeledDot,
	Stage,
} from "@sophistry/solidjs";

export const meta = {
	title: "Coordinate plane",
	description:
		"Axes map data coordinates to scene units: plot a function inside them, and use coordsToPoint() to place a point at (2, 4).",
	uses: [
		"Stage",
		"Axes",
		"FunctionGraph",
		"LabeledDot",
		"DashedLine",
		"coordsOf",
	],
};

export default function CoordinatePlane() {
	// The node is the handle; coordsOf reads the system it publishes.
	let axes!: SceneNode;
	const toScene = (x: number, y: number) =>
		coordsOf(axes)?.coordsToPoint(x, y) ?? ORIGIN;

	return (
		<Stage units={10}>
			<Axes
				ref={(node) => (axes = node)}
				xRange={[-3, 3, 1]}
				yRange={[0, 9, 3]}
				width={8}
				height={4.5}
				axis={{ numbers: true }}
				xLabel="x"
				yLabel="y"
			>
				<FunctionGraph function={(x) => x * x} />
			</Axes>
			<DashedLine from={toScene(2, 0)} to={toScene(2, 4)} />
			<LabeledDot center={toScene(2, 4)} minRadius={0.22} text="P" />
		</Stage>
	);
}
