import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import {
	Chart,
	FillBetween,
	LinePlot,
	Scatter,
} from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Line and area curves",
	description:
		"The same readings drawn three ways: a monotone curve (smooth, but never overshooting a reading) over a monotone band, a straight polyline, and a step-after line that holds each value until the next. Curves are native Béziers, and the reveal cuts them along x without straightening them.",
	uses: [
		"Stage",
		"Chart",
		"LinePlot",
		"FillBetween",
		"Scatter",
		"track",
		"draw",
		"usePlayer",
	],
};

const readings = [3, 3.2, 7.5, 8, 4, 4.2, 6.8, 2.5, 3, 6].map(
	(level, hour) => ({
		hour,
		level,
	}),
);
const shifted = (by: number) =>
	readings.map((r) => ({ hour: r.hour, level: r.level + by }));
const linear = shifted(-1.5);
const steps = shifted(-3);

export default function LineCurves() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 3 }));
	});

	return (
		<Stage units={12}>
			<Chart
				width={8}
				height={4.4}
				xLabel="hour"
				yRange={[-2, 10, 2]}
				grid="y"
				legend="top"
				// The top legend sits above height: leave it room.
				center={{ x: 0, y: -0.3 }}
				progress={shown}
			>
				<FillBetween
					data={readings}
					x="hour"
					y1={(r) => r.level + 0.8}
					y2={(r) => r.level - 0.8}
					curve="monotone"
				/>
				{/* A constant series per layer names each curve in the legend. */}
				<LinePlot
					data={readings}
					x="hour"
					y="level"
					series={() => "monotone"}
					curve="monotone"
				/>
				<LinePlot data={linear} x="hour" y="level" series={() => "linear"} />
				<LinePlot
					data={steps}
					x="hour"
					y="level"
					series={() => "step-after"}
					curve="step-after"
				/>
				<Scatter data={readings} x="hour" y="level" radius={0.06} />
			</Chart>
		</Stage>
	);
}
