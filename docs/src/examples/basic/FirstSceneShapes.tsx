import type { SceneNode } from "@sophistry/core";
import { derive, nextTo, UR } from "@sophistry/core";
import {
	Arc,
	Circle,
	Dot,
	Label,
	Line,
	Stage,
	useScene,
} from "@sophistry/solidjs";

export const meta = {
	title: "First scene: shapes and labels",
	description:
		"Step one of the first-scene tutorial: a ring, a radius, an angle arc and a dot, with a label placed next to the dot by its measured bounds.",
	uses: [
		"Stage",
		"Circle",
		"Line",
		"Arc",
		"Dot",
		"Label",
		"nextTo",
		"UR",
		"useScene",
		"derive",
	],
};

const R = 2.4;
const THETA = 0.9;

function Figure() {
	const theme = useScene().theme;
	const grid = derive(theme, (t) => t.palette.grid);
	const first = derive(theme, (t) => t.palette.series[0]);
	const second = derive(theme, (t) => t.palette.series[1]);
	const tip = { x: R * Math.cos(THETA), y: R * Math.sin(THETA) };
	let dot!: SceneNode;

	return (
		<>
			<Circle radius={R} stroke={grid} />
			<Line from={{ x: 0, y: 0 }} to={tip} stroke={first} />
			<Arc radius={0.8} angle={THETA} stroke={second} />
			<Label text="θ" x={1.15} y={0.35} color={second} />
			<Dot ref={(node) => (dot = node)} center={tip} />
			<Label
				text="P"
				ref={(name) =>
					name.set("place", nextTo(name.localBounds(), dot.bounds(), UR))
				}
			/>
		</>
	);
}

export default function FirstSceneShapes() {
	return (
		<Stage units={10}>
			<Figure />
		</Stage>
	);
}
