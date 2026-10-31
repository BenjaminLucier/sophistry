import type { Clock } from "@sophistry/core";
import {
	circle,
	createScene,
	derive,
	draggable,
	label,
	line,
	trackPoint,
} from "@sophistry/core";

export const meta = {
	title: "Dragging and node events",
	description:
		"draggable() makes a handle write a point track; a line and a caption follow it, and node.on() listens for hover and taps.",
	uses: [
		"createScene",
		"draggable",
		"trackPoint",
		"derive",
		"circle",
		"line",
		"label",
	],
};

export default function mount(host: HTMLElement, clock?: Clock): () => void {
	const scene = createScene({ host, clock, units: 10 });
	const handle = trackPoint(2, 1);

	scene.add(
		line.create({
			from: { x: 0, y: 0 },
			to: handle,
			stroke: "#6c7086",
			dash: [0.15, 0.1],
		}),
	);
	const knob = scene.add(
		circle.create({
			center: handle,
			radius: 0.3,
			fill: "#89b4fa",
			label: "handle", // keyboard focus: arrow keys nudge it
			...draggable(handle),
		}),
	);
	// The caption follows the handle: a derived position, no event code.
	scene.add(
		label.create({
			text: derive(handle, (p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`),
			x: derive(handle, (p) => p.x),
			y: derive(handle, (p) => p.y + 0.6),
		}),
	);
	// Events on the node itself; each `on` returns its unsubscribe.
	knob.on("enter", () => knob.set("fill", "#f9e2af"));
	knob.on("leave", () => knob.set("fill", "#89b4fa"));
	knob.on("doubletap", () => handle.set({ x: 2, y: 1 }));
	scene.add(
		label.create({ text: "drag the dot · double-tap to reset", y: -3.2 }),
	);
	return () => scene.dispose();
}
