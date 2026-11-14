import type { Clock } from "@sophistry/core";
import {
	circle,
	createScene,
	dot,
	draw,
	text,
	line,
	moveTo,
	sequence,
	track,
	trackPoint,
} from "@sophistry/core";

export const meta = {
	title: "A first scene, no framework",
	description:
		"createScene, a few definitions and two tracks: draw a ring, then move a point along it, from plain TypeScript.",
};

/** Builds the scene in `host`, on `clock`; returns its cleanup. */
export default function mount(host: HTMLElement, clock?: Clock): () => void {
	const scene = createScene({ host, clock, units: 10 });
	const drawn = track(0);
	const tip = trackPoint(2.4, 0);

	// `definition.create(props)` makes a node; a track given as a prop binds.
	scene.add(circle.create({ radius: 2.4, progress: drawn }));
	scene.add(line.create({ from: { x: 0, y: 0 }, to: tip, stroke: "#89b4fa" }));
	scene.add(dot.create({ center: tip }));
	scene.add(text.create({ text: "hello", y: -3.2 }));

	void scene.play(
		sequence(
			draw(drawn, { duration: 1.5 }),
			moveTo(tip, { x: 0, y: 2.4 }, { duration: 1 }),
		),
	);
	return () => scene.dispose();
}
