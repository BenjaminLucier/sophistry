import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Bars, Chart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Diverging stacked bars",
	description:
		'A Likert chart from long-format rows: series="answer" with layout="stack" sends negative values down from zero and positive values up, so disagreement and agreement grow apart from one centre line, and the chart\'s colour scale gives the legend in answer order. The question axis stands at the left edge, clear of the bars, and a zero line marks the baseline they grow from.',
};

const answers = ["strongly disagree", "disagree", "agree", "strongly agree"];
const sign = [-1, -1, 1, 1];
const survey = [
	{ q: "Clear docs", counts: [4, 10, 38, 22] },
	{ q: "Fast builds", counts: [12, 20, 25, 9] },
	{ q: "Easy setup", counts: [6, 14, 30, 18] },
].flatMap(({ q, counts }) =>
	counts.map((n, a) => ({ q, answer: answers[a], share: sign[a] * n })),
);
const palette = ["#ca0020", "#f4a582", "#92c5de", "#0571b0"];

export default function DivergingBars() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2 }));
	});

	return (
		<Stage units={12}>
			<Chart
				// "contain": width × height holds everything — the question
				// names on the left, the numbers below, the legend on top — so
				// the chart is simply centred on the stage.
				width={10.4}
				height={4.8}
				autosize="contain"
				xRange={[-40, 60, 20]}
				xAxis={{ tickFormat: (v) => `${Math.abs(v)}` }}
				// The question axis is a band axis, so it stands at the left
				// edge (not at zero, mid-chart), and the frame draws a zero
				// line for the bars to grow from. The domain pins the legend
				// to answer order and the range gives the diverging colours.
				color={{ domain: answers, range: palette }}
				legend="top"
				progress={shown}
			>
				<Bars
					data={survey}
					category="q"
					value="share"
					series="answer"
					orientation="horizontal"
					// Inner answers first, so each side stacks outward from zero.
					layout="stack"
					order={["disagree", "strongly disagree", "agree", "strongly agree"]}
					tooltip={(d) => `${d.answer}: ${Math.abs(d.share)}`}
				/>
			</Chart>
		</Stage>
	);
}
