import {
	changeSpeed,
	derive,
	hold,
	moveTo,
	parallel,
	sequence,
	trackPoint,
} from "@sophistry/core";
import {
	Dot,
	Stage,
	TracedPath,
	usePlayer,
	useScene,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Arcs, trails and changing speed",
	description:
		"Two dots swap places along half-circle arcs instead of straight lines, slowing right down as they pass each other, and each leaves a fading trail.",
	uses: [
		"Stage",
		"Dot",
		"TracedPath",
		"trackPoint",
		"derive",
		"moveTo",
		"changeSpeed",
		"parallel",
		"sequence",
		"hold",
		"usePlayer",
		"useScene",
	],
};

const LEFT = { x: -3, y: 0 };
const RIGHT = { x: 3, y: 0 };
/** Normal speed, a crawl around the middle, normal again. */
const SLOW_MIDDLE = { 0.35: 1, 0.5: 0.2, 0.65: 1 };

function Swap() {
	const theme = useScene().theme;
	const first = derive(theme, (t) => t.palette.series[0]);
	const second = derive(theme, (t) => t.palette.series[1]);
	const { play, signal } = usePlayer();
	const a = trackPoint(LEFT.x, LEFT.y);
	const b = trackPoint(RIGHT.x, RIGHT.y);

	const swap = (to: { a: typeof LEFT; b: typeof LEFT }) =>
		changeSpeed(
			parallel(
				moveTo(a, to.a, { duration: 1.5, pathArc: Math.PI }),
				moveTo(b, to.b, { duration: 1.5, pathArc: Math.PI }),
			),
			SLOW_MIDDLE,
		);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						swap({ a: RIGHT, b: LEFT }),
						hold(0.5),
						swap({ a: LEFT, b: RIGHT }),
						hold(0.5),
					),
				);
			}
		})();
	});

	return (
		<>
			<TracedPath point={a} dissipatingTime={1.2} stroke={first} />
			<TracedPath point={b} dissipatingTime={1.2} stroke={second} />
			<Dot center={a} radius={0.2} color={first} />
			<Dot center={b} radius={0.2} color={second} />
		</>
	);
}

export default function ArcsTrailsAndSpeed() {
	return (
		<Stage units={12}>
			<Swap />
		</Stage>
	);
}
