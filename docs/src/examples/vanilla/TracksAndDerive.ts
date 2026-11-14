import type { Clock } from "@sophistry/core";
import {
	arc,
	circle,
	createScene,
	derive,
	dot,
	forever,
	text,
	line,
	track,
	valueTo,
	watch,
} from "@sophistry/core";

export const meta = {
	title: "Tracks, derive and watch",
	description:
		"One track drives a dot, a radius, an arc and a caption through derive; watch mirrors it into the page once per frame.",
};

const RADIUS = 2.4;

export default function mount(host: HTMLElement, clock?: Clock): () => void {
	const scene = createScene({ host, clock, units: 10 });
	const turns = track(0);
	// Derived values recompute lazily, at most once per change, when read.
	const angle = derive(turns, (t) => (t % 1) * 2 * Math.PI);
	const tip = derive(angle, (a) => ({
		x: RADIUS * Math.cos(a),
		y: RADIUS * Math.sin(a),
	}));
	const degrees = derive(angle, (a) => Math.round((a * 180) / Math.PI));

	scene.add(circle.create({ radius: RADIUS, stroke: "#6c7086" }));
	scene.add(line.create({ from: { x: 0, y: 0 }, to: tip, stroke: "#89b4fa" }));
	scene.add(arc.create({ radius: 0.8, angle, stroke: "#f9e2af" }));
	scene.add(dot.create({ center: tip, color: "#f38ba8" }));
	scene.add(
		text.create({ text: derive(degrees, (d) => `θ = ${d}°`), x: 4, y: -2.2 }),
	);

	// A side effect outside the scene: runs in the commit phase, coalesced.
	const readout = host.appendChild(document.createElement("output"));
	const stop = watch(degrees, (d) => {
		readout.textContent = `angle: ${d}°`;
	});

	void scene.play(
		forever(valueTo(turns, (from) => from + 0.25, { duration: 1.2 })),
	);
	return () => {
		stop();
		readout.remove();
		scene.dispose();
	};
}
