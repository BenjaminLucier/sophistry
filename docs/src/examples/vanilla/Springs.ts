import type { Clock } from "@sophistry/core";
import {
	circle,
	createScene,
	follow,
	label,
	sequence,
	springTo,
	track,
	trackPoint,
} from "@sophistry/core";

export const meta = {
	title: "Springs: springTo and follow",
	description:
		"springTo is a seekable spring animation with an overshoot; follow keeps a second point chasing the first, live, preserving its velocity.",
};

export default function mount(host: HTMLElement, clock?: Clock): () => void {
	const scene = createScene({ host, clock, units: 10 });
	const leader = trackPoint(-3, 0);
	const follower = trackPoint(-3, 0);
	const size = track(0.2);

	scene.add(
		circle.create({
			center: follower,
			radius: 0.35,
			stroke: "#a6e3a1",
			strokeWidth: 0.06,
		}),
	);
	scene.add(
		circle.create({
			center: leader,
			radius: size,
			fill: "#f38ba8",
			stroke: "none",
		}),
	);
	scene.add(
		label.create({ text: "springTo (pink) · follow (green)", y: -3.2 }),
	);

	// A live follower on the scene's clock: retargets keep the velocity.
	const stop = follow(
		follower,
		leader,
		{ stiffness: 60, damping: 8 },
		{ clock: scene.clock },
	);

	const bouncy = { stiffness: 180, damping: 9 };
	void scene.play(
		springTo(size, 0.4, bouncy),
		sequence(
			springTo(leader, { x: 3, y: 1.5 }, bouncy),
			springTo(leader, { x: 0, y: -1.5 }, bouncy),
			springTo(leader, { x: -3, y: 0 }, { stiffness: 120, damping: 20 }),
		),
	);
	return () => {
		stop();
		scene.dispose();
	};
}
