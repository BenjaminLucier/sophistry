import {
	colorRamp,
	derive,
	radialGradient,
	sheen,
	track,
	valueTo,
} from "@sophistry/core";
import {
	Circle,
	DashedLine,
	Label,
	Path,
	Rect,
	Stage,
	usePlayer,
	useScene,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Gradients and strokes",
	description:
		"A lit sphere, a sheen that sweeps across a card, a dashed line and a stroke whose color follows the curve.",
};

const wave = Array.from({ length: 60 }, (_, i) => ({
	x: -1.6 + (i / 59) * 3.2,
	y: -0.9 + 0.5 * Math.sin((i / 59) * Math.PI * 3),
}));

function Swatches() {
	const { play, signal } = usePlayer();
	const series = derive(useScene().theme, (theme) => theme.palette.series);
	const at = track(0);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				at.set(0);
				await play(valueTo(at, 1, { duration: 2.5, easing: "linear" }));
			}
		})();
	});

	return (
		<>
			<Circle
				center={{ x: -3.6, y: 0.6 }}
				radius={1.3}
				strokeWidth={0}
				fill={derive(series, (s) =>
					radialGradient(["#ffffff", s[0], "#14213d"], {
						from: { x: 0.35, y: 0.7 },
					}),
				)}
			/>
			<Label text="radialGradient" x={-3.6} y={-1.3} fontSize={0.3} />

			<Rect
				center={{ x: 0, y: 0.6 }}
				width={3}
				height={2}
				cornerRadius={0.25}
				// From fully off one side of the card to fully off the other.
				fill={derive([series, at], (s, at) =>
					sheen(s[1], { at: at * 1.7 - 0.35 }),
				)}
				stroke={derive(series, (s) => s[1])}
			/>
			<Label text="sheen, animated by at" y={-1.3} fontSize={0.3} />

			<Path
				points={wave.map((p) => ({ x: p.x + 3.6, y: p.y + 1.5 }))}
				strokeWidth={0.14}
				strokeAlong={derive(series, (s) => {
					const heat = colorRamp([s[2], s[3], s[4]], { colorSpace: "oklch" });
					return Array.from({ length: 24 }, (_, i) => heat(i / 23));
				})}
			/>
			<DashedLine
				from={{ x: 2, y: -0.2 }}
				to={{ x: 5.2, y: -0.2 }}
				dashLength={0.18}
				strokeWidth={0.06}
				stroke={derive(series, (s) => s[3])}
			/>
			<Label text="strokeAlong + DashedLine" x={3.6} y={-1.3} fontSize={0.3} />
		</>
	);
}

export default function GradientsAndStrokes() {
	return (
		<Stage units={12}>
			<Swatches />
		</Stage>
	);
}
