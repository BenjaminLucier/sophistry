import type { SceneNode } from "@sophistry/core";
import {
	coordsOf,
	derive,
	draw,
	hold,
	ORIGIN,
	sequence,
	track,
	valueTo,
} from "@sophistry/core";
import {
	Axes,
	Dot,
	FunctionGraph,
	Label,
	Line,
	Stage,
	usePlayer,
	useScene,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "A tracker and a dot on a graph",
	description:
		"Manim's ValueTracker plus always_redraw, as a track() and derive(): a dot rides y = sin x while its x readout updates.",
};

function Tracker() {
	const { play, signal } = usePlayer();
	const theme = useScene().theme;
	const drawn = track(0);
	const x = track(0);
	// The node is the handle; coordsOf reads the system it publishes.
	let axes!: SceneNode;
	const toScene = (x: number, y: number) =>
		coordsOf(axes)?.coordsToPoint(x, y) ?? ORIGIN;

	onSettled(() => {
		void (async () => {
			await play(draw(drawn, { duration: 1.5 }));
			while (!signal.aborted) {
				await play(
					sequence(
						valueTo(x, 2 * Math.PI, { duration: 4, easing: "smooth" }),
						hold(0.6),
						valueTo(x, 0, { duration: 1.5, easing: "smooth" }),
						hold(0.6),
					),
				);
			}
		})();
	});

	return (
		<>
			<Axes
				ref={(node) => (axes = node)}
				xRange={[0, 7, 1]}
				yRange={[-1.5, 1.5, 0.5]}
				width={11}
				height={4.5}
			>
				<FunctionGraph
					function={Math.sin}
					stroke={derive(theme, (t) => t.palette.series[0])}
					progress={drawn}
				/>
			</Axes>
			<Line
				from={derive(x, (x) => toScene(x, 0))}
				to={derive(x, (x) => toScene(x, Math.sin(x)))}
				stroke={derive(theme, (t) => t.palette.muted)}
				dash={[0.1, 0.1]}
			/>
			<Dot
				center={derive(x, (x) => toScene(x, Math.sin(x)))}
				radius={0.14}
				color={derive(theme, (t) => t.palette.series[1])}
			/>
			<Label text={derive(x, (x) => `x = ${x.toFixed(2)}`)} y={3.4} />
		</>
	);
}

export default function ValueTrackerDot() {
	return (
		<Stage units={14}>
			<Tracker />
		</Stage>
	);
}
