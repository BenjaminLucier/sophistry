import { derive, GOLD, hold, track, valueTo } from "@sophistry/core";
import { Circle, Dot, Line, Plot, Stage, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Sine curve from the unit circle",
	description:
		"A point circles a unit circle while its height is traced out as a sine wave to the right.",
};

const R = 1.5;
const CENTER = { x: -3.6, y: 0 };
const WAVE_X = -1.8;

export default function SineCurveUnitCircle() {
	const { play, signal } = usePlayer();
	const theta = track(0);
	const dot = derive(theta, (theta) => ({
		x: CENTER.x + R * Math.cos(theta),
		y: R * Math.sin(theta),
	}));
	const tip = derive([theta, dot], (theta, dot) => ({
		x: WAVE_X + 0.9 * theta,
		y: dot.y,
	}));

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				theta.set(0);
				await play(
					valueTo(theta, 2 * Math.PI, { duration: 6, easing: "linear" }),
				);
				await play(hold(1.5));
			}
		})();
	});

	return (
		<Stage units={12}>
			<Line from={{ x: -5.6, y: 0 }} to={{ x: 5.2, y: 0 }} opacity={0.4} />
			<Circle center={CENTER} radius={R} />
			<Line from={CENTER} to={dot} />
			<Line from={dot} to={tip} dash={[0.1, 0.1]} opacity={0.6} />
			<Plot
				function={(t) => ({ x: WAVE_X + 0.9 * t, y: R * Math.sin(t) })}
				from={0}
				to={theta}
				stroke={GOLD}
			/>
			<Dot center={dot} />
			<Dot center={tip} color={GOLD} />
		</Stage>
	);
}
