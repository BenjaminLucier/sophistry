import {
	derive,
	type Easing,
	hold,
	parallel,
	sequence,
	squish,
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
	title: "Manim's rate functions",
	description:
		"Six dots make the same trip with Manim's rate functions: a running start, slow into the end, two smooth halves, lingering, exponential decay, and a smooth move squished into the second half.",
	uses: [
		"Stage",
		"Dot",
		"Label",
		"Line",
		"track",
		"derive",
		"valueTo",
		"squish",
		"parallel",
		"sequence",
		"hold",
		"usePlayer",
		"useScene",
	],
};

const CURVES: { name: string; easing: Easing }[] = [
	{ name: "runningStart", easing: "runningStart" },
	{ name: "slowInto", easing: "slowInto" },
	{ name: "doubleSmooth", easing: "doubleSmooth" },
	{ name: "lingering", easing: "lingering" },
	{ name: "exponentialDecay", easing: "exponentialDecay" },
	{ name: "squish(smooth, 0.5, 1)", easing: squish("smooth", 0.5, 1) },
];
const START = -1;
const END = 5;

function Trips() {
	const theme = useScene().theme;
	const { play, signal } = usePlayer();
	const xs = CURVES.map(() => track(START));

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						parallel(
							...xs.map((x, i) =>
								valueTo(x, END, { duration: 2.5, easing: CURVES[i].easing }),
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

	return CURVES.map((curve, i) => {
		const y = 2.5 - i;
		const color = derive(
			theme,
			(t) => t.palette.series[i % t.palette.series.length],
		);
		return (
			<>
				<Line from={{ x: START, y }} to={{ x: END, y }} opacity={0.25} />
				<Label
					text={curve.name}
					x={-5.6}
					y={y}
					align="left"
					fontSize={0.32}
					color={color}
				/>
				<Dot
					center={derive(xs[i], (x) => ({ x, y }))}
					radius={0.18}
					color={color}
				/>
			</>
		);
	});
}

export default function RateFunctions() {
	return (
		<Stage units={12}>
			<Trips />
		</Stage>
	);
}
