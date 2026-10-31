import {
	derive,
	hold,
	parallel,
	sequence,
	track,
	valueTo,
} from "@sophistry/core";
import {
	Dot,
	Label,
	Line,
	Stage,
	usePlayer,
	useScene,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Comparing easings",
	description:
		"Five dots cover the same distance in the same time, each with a different easing curve, so you can see how the curves feel.",
	uses: [
		"Stage",
		"Dot",
		"Label",
		"Line",
		"track",
		"derive",
		"valueTo",
		"parallel",
		"sequence",
		"hold",
		"usePlayer",
		"useScene",
	],
};

const EASINGS = [
	"linear",
	"inOut",
	"backOut",
	"elasticOut",
	"bounceOut",
] as const;
const START = -2;
// Room past the end for elasticOut, which overshoots by a third or more.
const END = 3;

function Race() {
	const theme = useScene().theme;
	const { play, signal } = usePlayer();
	const xs = EASINGS.map(() => track(START));

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						parallel(
							...xs.map((x, i) =>
								valueTo(x, END, { duration: 2, easing: EASINGS[i] }),
							),
						),
						hold(1),
					),
				);
				for (const x of xs) x.set(START);
				await play(hold(0.5));
			}
		})();
	});

	return (
		<>
			<Line
				from={{ x: START, y: 2.5 }}
				to={{ x: START, y: -2.5 }}
				dash={[0.1, 0.1]}
			/>
			<Line
				from={{ x: END, y: 2.5 }}
				to={{ x: END, y: -2.5 }}
				dash={[0.1, 0.1]}
			/>
			{EASINGS.map((name, i) => {
				const y = 2 - i;
				const color = derive(theme, (t) => t.palette.series[i]);
				return (
					<>
						<Line from={{ x: START, y }} to={{ x: END, y }} opacity={0.25} />
						<Label
							text={name}
							x={-4.6}
							y={y}
							align="left"
							fontSize={0.4}
							color={color}
						/>
						<Dot
							center={derive(xs[i], (x) => ({ x, y }))}
							radius={0.2}
							color={color}
						/>
					</>
				);
			})}
		</>
	);
}

export default function EasingComparison() {
	return (
		<Stage units={10}>
			<Race />
		</Stage>
	);
}
