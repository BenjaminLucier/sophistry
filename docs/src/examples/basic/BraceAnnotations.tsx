import type { SceneNode } from "@sophistry/core";
import { DOWN, draw, lagged, RIGHT, track } from "@sophistry/core";
import { Brace, Polygon, Rect, Stage, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Braces",
	description:
		"Braces measure a rectangle's sides and a triangle's hypotenuse, each with a label at its tip, drawn in one after another.",
	uses: [
		"Stage",
		"Rect",
		"Polygon",
		"Brace",
		"DOWN",
		"RIGHT",
		"track",
		"draw",
		"lagged",
		"usePlayer",
	],
};

const A = { x: 1.5, y: -1.5 };
const B = { x: 5, y: -1.5 };
const C = { x: 5, y: 1.5 };

export default function BraceAnnotations() {
	const { play } = usePlayer();
	const braces = [track(0), track(0), track(0)];
	// The node is the handle: the rectangle exists before the braces read its bounds.
	let box!: SceneNode;

	onSettled(() => {
		void play(
			lagged(
				braces.map((b) => draw(b)),
				{ lagRatio: 0.6 },
			),
		);
	});

	return (
		<Stage units={12}>
			<Rect
				ref={(node) => (box = node)}
				center={{ x: -2.5, y: 0 }}
				width={4}
				height={2}
			/>
			<Brace
				target={box.bounds()}
				direction={DOWN}
				label="width"
				progress={braces[0]}
			/>
			<Brace
				target={box.bounds()}
				direction={RIGHT}
				label="h"
				progress={braces[1]}
			/>
			<Polygon points={[A, B, C]} />
			{/* C to A: the tip points to the right of travel, away from the triangle. */}
			<Brace from={C} to={A} gap={0.15} label="c" progress={braces[2]} />
		</Stage>
	);
}
