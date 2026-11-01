import {
	derive,
	draw,
	parallel,
	sequence,
	track,
	valueTo,
} from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Bars, Chart, ChartZoom, RangeBrush } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Zooming a category axis",
	description:
		"The top chart is a window onto twelve of thirty-six months. Scroll over it to zoom, drag to pan, or Tab to it and use the arrows and + and -: drags, pinches and keys settle on whole months, and the names leaving the window fade. The overview's brush reads the same two tracks; scroll over the brush to grow or shrink it.",
};

const NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
const months = Array.from({ length: 36 }, (_, i) => ({
	month: `${2023 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
	units: Math.round(
		40 + 18 * Math.sin((i / 12) * 2 * Math.PI - 1.2) + i * 0.9 + ((i * 7) % 5),
	),
}));
/** "Jan 24" on a January, else the month. */
const monthName = (key: string | number) => {
	const [year, month] = String(key).split("-").map(Number);
	const name = NAMES[month - 1];
	return month === 1 ? `${name} ${String(year).slice(2)}` : name;
};

export default function CategoryZoom() {
	const player = usePlayer();
	const shown = track(0);
	// Slot edges: the window holds categories from..to (category i spans i..i + 1).
	const from = track(0);
	const to = track(12);
	onSettled(() => {
		void player.play(
			sequence(
				draw(shown, { duration: 1.5 }),
				parallel(
					valueTo(from, 12, { duration: 1.6 }),
					valueTo(to, 24, { duration: 1.6 }),
				),
			),
		);
	});

	return (
		<Stage units={12}>
			<Chart
				width={10}
				height={3.4}
				center={{ x: 0.2, y: 1.1 }}
				xRange={derive([from, to], (start, end) => [start, end])}
				xAxis={{ categoryLabel: (key) => monthName(key) }}
				yLabel="units"
				clip
				progress={shown}
			>
				<ChartZoom x={[from, to]} label="monthly units" />
				<Bars data={months} category="month" value="units" />
			</Chart>
			<Chart
				width={10}
				height={0.9}
				center={{ x: 0.2, y: -2.35 }}
				xAxis={{
					categoryLabel: (key, i) => (i % 6 === 0 ? monthName(key) : ""),
				}}
				yAxis={{ visible: false }}
				progress={shown}
			>
				<Bars data={months} category="month" value="units" />
				<RangeBrush from={from} to={to} wheel label="months shown" />
			</Chart>
		</Stage>
	);
}
