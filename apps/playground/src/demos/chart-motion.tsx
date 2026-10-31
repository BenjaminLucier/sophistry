import {
	derive,
	draw,
	hold,
	parallel,
	sequence,
	track,
	valueTo,
} from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import {
	Bars,
	Chart,
	FillBetween,
	LinePlot,
	PolarAreaChart,
	RadarChart,
	Scatter,
} from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

/** A keyed transition: B grows, C leaves, D arrives, and the fitted axes follow. */
const SALES = [
	{ k: "A", v: 3 },
	{ k: "B", v: 5 },
	{ k: "C", v: 2 },
];
const NEXT = [
	{ k: "A", v: 4 },
	{ k: "B", v: 9 },
	{ k: "D", v: 6 },
];

const SERIES = [3, 5, 4, 7, 6, 8, 7, 9].map((y, x) => ({
	x,
	y,
	lo: y - 1,
	hi: y + 1,
}));

/** The series one higher: the scatter's keyed transition (by index). */
const RAISED = SERIES.map((d) => ({ ...d, y: d.y + 1 }));

/**
 * Clipping, one reveal front across the
 * chart's layers, an animated domain and radial sweeps. Tracks are the props
 * themselves; the animated `yRange` (a `{ from, to, t }` object) is a `derive` of the `zoom` track, so it too binds in
 * core with no Solid work per frame.
 */
export function ChartMotionDemo() {
	const shown = track(0);
	const zoom = track(0);
	const blend = track(0);
	const yRange = derive(zoom, (t) => ({
		from: [0, 10] as [number, number],
		to: [2, 12] as [number, number],
		t,
	}));
	const player = usePlayer();

	onSettled(() => {
		void player.play(
			parallel(
				draw(shown, { duration: 1.2 }),
				sequence(hold(0.4), valueTo(zoom, 1, { duration: 1.2 })),
				sequence(
					hold(0.5),
					valueTo(blend, 1, { duration: 1.2, easing: "linear" }),
				),
			),
		);
	});

	return (
		<Stage units={16}>
			<Chart
				width={7}
				height={4}
				center={{ x: -3.5, y: 0 }}
				clip
				reveal="x"
				grid="y"
				progress={shown}
				xRange={[0, 7]}
				yRange={yRange}
				yAxis={{ tickFormat: ",.1f" }}
			>
				<FillBetween data={SERIES} x="x" y1="lo" y2="hi" stroke="#58c4dd" />
				<LinePlot data={SERIES} x="x" y="y" />
				<Scatter
					data={SERIES}
					to={RAISED}
					blend={blend}
					x="x"
					y="y"
					radius={0.07}
				/>
			</Chart>
			<Chart width={3} height={1.6} center={{ x: 2.4, y: -2.9 }}>
				<Bars
					data={SALES}
					to={NEXT}
					blend={blend}
					category="k"
					value="v"
					key="k"
					labels
				/>
			</Chart>
			<RadarChart
				data={[
					[8, 6, 7, 5, 9],
					[5, 9, 4, 8, 6],
				]}
				maxValue={10}
				center={{ x: 3, y: 1 }}
				radius={1.4}
				progress={shown}
			/>
			<PolarAreaChart
				data={[4, 8, 6, 10, 3]}
				center={{ x: 6.2, y: -1.5 }}
				radius={1.2}
				labels={false}
				progress={shown}
			/>
		</Stage>
	);
}
