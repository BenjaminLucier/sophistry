import { brushedCategories } from "@sophistry/charts";
import {
	derive,
	draw,
	parallel,
	sequence,
	track,
	valueTo,
} from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Bars, Chart, RangeBrush } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Brushing categories on a band axis",
	description:
		"On a category axis the brush snaps to whole bars, and an arrow key moves it one bar. brushedCategories turns its two tracks into the months it covers, which the chart below breaks down by product.",
};

const months = [
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
const sales = months.flatMap((month, i) =>
	["tea", "coffee", "cocoa"].map((product, j) => ({
		month,
		product,
		units:
			4 + ((i * (j + 2) + 3 * j) % 7) + (j === 2 ? 6 - Math.abs(i - 6) : 0),
	})),
);

const totals = months.map((month) => ({
	month,
	units: sales
		.filter((d) => d.month === month)
		.reduce((sum, d) => sum + d.units, 0),
}));

export default function CategoryBrush() {
	const { play } = usePlayer();
	const shown = track(0);
	const from = track(1);
	const to = track(4);
	onSettled(() => {
		void play(
			sequence(
				draw(shown, { duration: 1.5 }),
				parallel(
					valueTo(from, 6, { duration: 1.4 }),
					valueTo(to, 9, { duration: 1.4 }),
				),
			),
		);
	});
	// The months the brush covers, and the rows for them, follow its two tracks.
	const picked = derive([from, to], (low, high) =>
		brushedCategories(months, low, high),
	);

	return (
		<Stage units={12}>
			<Chart width={10} height={1.6} center={{ x: 0, y: 2.2 }} progress={shown}>
				<Bars data={totals} category="month" value="units" />
				<RangeBrush from={from} to={to} label="months" />
			</Chart>
			<Chart
				width={10}
				height={2.6}
				center={{ x: 0, y: -1.6 }}
				xAxis={derive(picked, (categories) => ({ categories }))}
				legend="top"
				progress={shown}
			>
				<Bars
					data={derive(picked, (categories) =>
						sales.filter((d) => categories.includes(d.month)),
					)}
					category="month"
					value="units"
					series="product"
					layout="dodge"
				/>
			</Chart>
		</Stage>
	);
}
