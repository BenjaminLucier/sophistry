import {
	derive,
	draw,
	parallel,
	sequence,
	track,
	valueTo,
} from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import {
	Chart,
	ChartZoom,
	LinePlot,
	RangeBrush,
} from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Zoom a chart with the wheel, a pinch or the keys",
	description:
		"Scroll over the top chart to zoom about the cursor, drag it to pan, pinch on a touch screen, or Tab to it and use + and -, the arrows, and 0 to reset. The zoom writes two tracks and the overview's brush reads the same two, so it follows the zoom, and dragging the brush moves it.",
};

const last = 239;
const signal = Array.from({ length: last + 1 }, (_, t) => ({
	t,
	v: Math.sin(t / 9) + 0.4 * Math.sin(t / 2.7) + t / 90,
}));

export default function ChartZoomPan() {
	const player = usePlayer();
	const shown = track(0);
	const from = track(0);
	const to = track(last);
	onSettled(() => {
		void player.play(
			sequence(
				draw(shown, { duration: 1.5 }),
				parallel(
					valueTo(from, 70, { duration: 1.6 }),
					valueTo(to, 150, { duration: 1.6 }),
				),
			),
		);
	});

	return (
		<Stage units={12}>
			<Chart
				width={9.5}
				height={3.6}
				center={{ x: 0.2, y: 1.0 }}
				xRange={derive([from, to], (start, end) => [start, end])}
				xAxis={{ position: "bottom" }}
				yLabel="signal"
				clip
				progress={shown}
			>
				<ChartZoom x={[from, to]} bounds={[0, last]} minSpan={10} />
				<LinePlot data={signal} x="t" y="v" />
			</Chart>
			<Chart
				width={9.5}
				height={0.9}
				center={{ x: 0.2, y: -2.35 }}
				yAxis={{ visible: false }}
				progress={shown}
			>
				<LinePlot data={signal} x="t" y="v" />
				<RangeBrush from={from} to={to} minSpan={10} />
			</Chart>
		</Stage>
	);
}
