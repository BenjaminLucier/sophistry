import type { Placement, SceneNode } from "@sophistry/core";
import { arrange, DOWN, nextTo, RIGHT } from "@sophistry/core";
import { Circle, Label, Square, Stage, Star } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Labels and positioning",
	description:
		"Line three shapes up with arrange(), then hang a caption beneath one with nextTo(), using each shape's measured bounds.",
};

/** Any node with a `place` prop: shapes and labels. */
type Placeable = SceneNode<{ place?: Placement }>;

export default function LabelsAndPositioning() {
	// The nodes are the handles: once they exist, measure them and place them.
	const shapes: Placeable[] = [];
	let caption!: Placeable;
	onSettled(() => {
		const row = arrange(
			shapes.map((shape) => shape.localBounds()),
			RIGHT,
			{ gap: 0.8 },
		);
		for (const [i, shape] of shapes.entries()) shape.set("place", row[i]);
		caption.set(
			"place",
			nextTo(caption.localBounds(), shapes[1].bounds(), DOWN, { gap: 0.6 }),
		);
	});

	return (
		<Stage units={10}>
			<Circle ref={(node) => shapes.push(node)} radius={0.7} />
			<Square ref={(node) => shapes.push(node)} size={1.4} />
			<Star ref={(node) => shapes.push(node)} outerRadius={0.8} />
			<Label
				ref={(node) => (caption = node)}
				text="arrange(RIGHT), then nextTo(DOWN)"
			/>
		</Stage>
	);
}
