import type {
	ArrowProps,
	Placement,
	SceneNode,
	SurroundingRectangleProps,
} from "@sophistry/core";
import {
	arrange,
	DOWN,
	derive,
	LEFT,
	nextTo,
	ORIGIN,
	RIGHT,
	toCorner,
	UL,
	unionBounds,
} from "@sophistry/core";
import {
	Arrow,
	Label,
	Rect,
	Stage,
	SurroundingRectangle,
	useScene,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "A diagram laid out by placement",
	description:
		"Three boxes in a row, captions under each, arrows between them, a frame around the lot and a title pinned to the corner. No coordinates are typed by hand.",
	uses: [
		"Stage",
		"Rect",
		"Label",
		"Arrow",
		"SurroundingRectangle",
		"arrange",
		"nextTo",
		"toCorner",
		"unionBounds",
		"useScene",
		"derive",
	],
};

const STEPS = ["parse", "transform", "render"];

/** Any node with a `place` prop: shapes and labels. */
type Placeable = SceneNode<{ place?: Placement }>;

function Diagram() {
	const scene = useScene();
	const series = derive(scene.theme, (theme) => theme.palette.series);
	const muted = derive(scene.theme, (theme) => theme.palette.muted);
	const border = derive(scene.theme, (theme) => theme.palette.border);

	// The nodes are the handles: once they exist, measure them and place them.
	const boxes: Placeable[] = [];
	const captions: Placeable[] = [];
	const arrows: SceneNode<ArrowProps>[] = [];
	let frame!: SceneNode<SurroundingRectangleProps>;
	let title!: Placeable;

	onSettled(() => {
		const row = arrange(
			boxes.map((box) => box.localBounds()),
			RIGHT,
			{ gap: 1.2 },
		);
		for (const [i, box] of boxes.entries()) {
			box.set("place", row[i]);
			const caption = captions[i];
			caption.set(
				"place",
				nextTo(caption.localBounds(), box.bounds(), DOWN, { gap: 0.3 }),
			);
		}
		// Another shape's bounds may feed geometry props (arrow ends, a frame).
		for (const [i, arrow] of arrows.entries()) {
			arrow.update({
				from: boxes[i].pointAt(RIGHT) ?? ORIGIN,
				to: boxes[i + 1].pointAt(LEFT) ?? ORIGIN,
			});
		}
		frame.set(
			"target",
			unionBounds(...[...boxes, ...captions].map((node) => node.bounds())),
		);
		title.set(
			"place",
			toCorner(title.localBounds(), scene.frame.peek(), UL, { margin: 0.4 }),
		);
	});

	return (
		<>
			{STEPS.map((step, i) => (
				<>
					<Rect
						ref={(node) => boxes.push(node)}
						width={2.2}
						height={1.2}
						cornerRadius={0.2}
						stroke={derive(series, (s) => s[i])}
						fill={derive(series, (s) => s[i])}
						fillOpacity={0.25}
					/>
					<Label
						ref={(node) => captions.push(node)}
						text={step}
						fontSize={0.34}
					/>
				</>
			))}
			{[0, 1].map(() => (
				<Arrow
					ref={(node) => arrows.push(node)}
					from={ORIGIN}
					to={ORIGIN}
					strokeWidth={0.06}
					stroke={muted}
				/>
			))}
			<SurroundingRectangle
				ref={(node) => (frame = node)}
				target={null}
				padding={0.4}
				cornerRadius={0.2}
				dash={[0.15, 0.1]}
				stroke={border}
			/>
			<Label
				ref={(node) => (title = node)}
				text="A tiny pipeline"
				fontSize={0.4}
				fontWeight={600}
			/>
		</>
	);
}

export default function LabelledDiagram() {
	return (
		<Stage units={12}>
			<Diagram />
		</Stage>
	);
}
