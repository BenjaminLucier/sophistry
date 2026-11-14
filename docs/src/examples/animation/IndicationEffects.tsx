import {
	applyWave,
	blink,
	derive,
	focusOn,
	hold,
	passingFlash,
	sequence,
	showPassingFlash,
	track,
} from "@sophistry/core";
import type { Polyline } from "@sophistry/core/geometry";
import { measure, rectPolyline } from "@sophistry/core/geometry";
import {
	Circle,
	Dot,
	Text,
	Path,
	Stage,
	usePlayer,
	useScene,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Indication effects",
	description:
		"Four more ways to point at something: a spotlight closes in, a dot blinks, a flash runs along a curve, and a wave ripples through a bar.",
};

const curve: Polyline = Array.from({ length: 41 }, (_, i) => {
	const x = -1.4 + (i / 40) * 2.8;
	return { x: x + 1.6, y: 0.8 * Math.sin(x * 2.2) };
});
const curveLength = measure(curve).total;

function Effects() {
	const palette = derive(useScene().theme, (t) => t.palette);
	const { play, signal } = usePlayer();
	const spot = track(6);
	const spotOpacity = track(0);
	const shown = track(1);
	const flash = track(0);
	const bar = track(rectPolyline(3.6, -0.25, 2.8, 0.5));
	const flashed = derive(flash, (t) => passingFlash(curveLength, t, 0.25));

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						focusOn(spot, spotOpacity, { duration: 1.5 }),
						blink(shown, { blinks: 3, timeOn: 0.2, timeOff: 0.2 }),
						showPassingFlash(flash, { duration: 1.2 }),
						applyWave(bar, { amplitude: 0.5, duration: 1.5 }),
						hold(1),
					),
				);
			}
		})();
	});

	return (
		<>
			<Circle
				center={{ x: -4.5, y: 0 }}
				radius={spot}
				fill={derive(palette, (p) => p.foreground)}
				stroke="none"
				opacity={spotOpacity}
			/>
			<Dot center={{ x: -4.5, y: 0 }} radius={0.2} />
			<Dot center={{ x: -1.5, y: 0 }} radius={0.35} opacity={shown} />
			<Path points={curve} opacity={0.35} />
			<Path
				points={curve}
				stroke={derive(palette, (p) => p.highlight)}
				strokeWidth={0.08}
				dash={derive(flashed, (f) => f.dash)}
				dashOffset={derive(flashed, (f) => f.dashOffset)}
				visible={derive(flashed, (f) => f.visible)}
			/>
			<Path points={bar} closed fill={derive(palette, (p) => p.accent)} />
			<Text text="focusOn" x={-4.5} y={-2} />
			<Text text="blink" x={-1.5} y={-2} />
			<Text text="showPassingFlash" x={1.6} y={-2} />
			<Text text="applyWave" x={5} y={-2} />
		</>
	);
}

export default function IndicationEffects() {
	return (
		<Stage units={14}>
			<Effects />
		</Stage>
	);
}
