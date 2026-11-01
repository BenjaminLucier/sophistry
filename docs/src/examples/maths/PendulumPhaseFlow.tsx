import { derive, hold, phaseFlow, sequence, track } from "@sophistry/core";
import { circlePolyline } from "@sophistry/core/geometry";
import {
	Path,
	Stage,
	StreamLines,
	usePlayer,
	useScene,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "A pendulum's phase flow",
	description:
		"A disc of starting states flows along a pendulum's phase portrait: near the bottom it circles round, and it stretches into a thin arc as the swings drift out of step.",
};

/** Angle along x, angular velocity along y. */
const pendulum = ({ x, y }: { x: number; y: number }) => ({
	x: y,
	y: -Math.sin(x),
});
const start = () => circlePolyline(-1.6, 0, 0.45);

function Flow() {
	const theme = useScene().theme;
	const { play, signal } = usePlayer();
	const disc = track(start());

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				disc.set(start());
				await play(
					sequence(
						hold(0.5),
						phaseFlow(disc, pendulum, { virtualTime: 6, duration: 4 }),
						hold(1),
					),
				);
			}
		})();
	});

	return (
		<>
			<StreamLines
				function={pendulum}
				xRange={[-5, 5]}
				yRange={[-2.8, 2.8]}
				opacity={0.35}
			/>
			<Path
				points={disc}
				closed
				fill={derive(theme, (t) => t.palette.accent)}
				fillOpacity={0.6}
				stroke={derive(theme, (t) => t.palette.foreground)}
				strokeWidth={0.02}
			/>
		</>
	);
}

export default function PendulumPhaseFlow() {
	return (
		<Stage units={10}>
			<Flow />
		</Stage>
	);
}
