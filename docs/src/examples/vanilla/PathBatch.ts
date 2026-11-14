import type { Clock, PathBatchItem } from "@sophistry/core";
import {
	createScene,
	derive,
	forever,
	text,
	pathBatch,
	track,
	valueTo,
} from "@sophistry/core";

export const meta = {
	title: "PathBatch: many outlines, one node",
	description:
		"A field of 600 arrowheads, each its own outline and colour, drawn by one pathBatch node whose items derive from a single phase track.",
};

/** An arrowhead at `(x, y)` pointing along `angle`. */
function arrow(
	x: number,
	y: number,
	angle: number,
	length: number,
): PathBatchItem {
	const at = (along: number, across: number) => ({
		x: x + along * Math.cos(angle) - across * Math.sin(angle),
		y: y + along * Math.sin(angle) + across * Math.cos(angle),
	});
	const hue = Math.round(((angle / Math.PI) * 180 + 360) % 360);
	return {
		closed: true,
		polylines: [
			[
				at(length, 0),
				at(-length / 2, length / 2),
				at(-length / 4, 0),
				at(-length / 2, -length / 2),
			],
		],
		fill: `hsl(${hue} 70% 70%)`,
	};
}

export default function mount(host: HTMLElement, clock?: Clock): () => void {
	const scene = createScene({ host, clock, units: 16 });
	const phase = track(0);
	// One node, 600 distinct outlines, rebuilt from the phase each frame it moves.
	const items = derive(phase, (p) =>
		Array.from({ length: 600 }, (_, i) => {
			const x = (i % 30) * 0.5 - 7.25;
			const y = Math.floor(i / 30) * 0.4 - 3.8;
			const angle = Math.sin(x * 0.6 + p) + Math.cos(y * 0.8 - p);
			return arrow(x, y, angle * 1.5, 0.12 + 0.06 * Math.abs(Math.sin(angle)));
		}),
	);
	scene.add(pathBatch.create({ items, stroke: "none" }));
	scene.add(
		text.create({ text: "600 outlines, one PathBatch node", y: -4.3 }),
	);
	void scene.play(
		forever(
			valueTo(phase, (from) => from + 2 * Math.PI, {
				duration: 6,
				easing: "linear",
			}),
		),
	);
	return () => scene.dispose();
}
