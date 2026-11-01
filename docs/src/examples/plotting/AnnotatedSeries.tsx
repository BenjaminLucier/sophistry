import { draw, track, UP } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import {
	Chart,
	Labels,
	LinePlot,
	Rects,
	RuleY,
	Scatter,
} from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Annotated series",
	description:
		"Marks layered in one chart: a shaded span, a target rule, the series, labelled points with tooltips.",
};

const sales = [3.1, 3.6, 4.2, 3.4, 2.6, 2.9, 4.4, 5.1, 5.6, 6.2];
const peak = { month: 9, value: 6.2, note: "record" };

export default function AnnotatedSeries() {
	const { play } = usePlayer();
	const shown = track(0);

	onSettled(() => {
		void play(draw(shown, { duration: 3 }));
	});

	return (
		<Stage units={13}>
			<Chart width={9} height={4.5} xLabel="month" yLabel="£m" progress={shown}>
				{/* A slump, shaded behind the data, and the year's target. */}
				<Rects data={[{ from: 3, to: 5 }]} x1="from" x2="to" color="tomato" />
				<RuleY data={[5]} dash={[0.1, 0.08]} tooltip={() => "target: £5m"} />
				<LinePlot data={sales} />
				<Scatter
					data={sales}
					symbol="diamond"
					radius={0.11}
					stagger={0.6}
					tooltip
				/>
				<Labels data={[peak]} x="month" y="value" text="note" direction={UP} />
			</Chart>
		</Stage>
	);
}
