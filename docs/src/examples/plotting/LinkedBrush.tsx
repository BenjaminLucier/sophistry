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
	ChartLink,
	LinePlot,
	RangeBrush,
	Rects,
} from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Brushing linked charts",
	description:
		"An overview with a draggable range brush drives two detail charts linked on x. The brush writes two tracks and the link reads them, so dragging it, using the arrow keys, or animating the tracks (as here) zooms both details together, and scrubbing the timeline replays it.",
};

const days = Array.from({ length: 90 }, (_, t) => ({
	t,
	price: 20 + 3 * Math.sin(t / 7) + Math.sin(t / 2.3) + t * 0.06,
	volume: 2 + 1.5 * Math.abs(Math.cos(t / 3.1)) + (t % 7 === 0 ? 1.5 : 0),
}));

export default function LinkedBrush() {
	const { play } = usePlayer();
	const shown = track(0);
	const from = track(10);
	const to = track(30);
	onSettled(() => {
		void play(
			sequence(
				draw(shown, { duration: 2 }),
				parallel(
					valueTo(from, 52, { duration: 2.4 }),
					valueTo(to, 80, { duration: 2.4 }),
				),
			),
		);
	});

	return (
		<Stage units={12}>
			<ChartLink xRange={derive([from, to], (low, high) => [low, high])}>
				<Chart
					width={9.5}
					height={1.6}
					center={{ x: 0.2, y: 1.95 }}
					yLabel="price"
					clip
					progress={shown}
				>
					<LinePlot data={days} x="t" y="price" />
				</Chart>
				<Chart
					width={9.5}
					height={1}
					center={{ x: 0.2, y: -0.6 }}
					yLabel="volume"
					clip
					progress={shown}
				>
					<Rects
						data={days}
						x1={(d) => d.t - 0.35}
						x2={(d) => d.t + 0.35}
						y1={() => 0}
						y2="volume"
						color="#89b4fa"
					/>
				</Chart>
			</ChartLink>
			<Chart
				width={9.5}
				height={0.8}
				center={{ x: 0.2, y: -2.4 }}
				yAxis={{ visible: false }}
				progress={shown}
			>
				<LinePlot data={days} x="t" y="price" />
				<RangeBrush from={from} to={to} minSpan={5} />
			</Chart>
		</Stage>
	);
}
