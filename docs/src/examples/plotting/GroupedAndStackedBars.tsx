import { draw, track } from "@sophistry/core";
import { Label, Stage, usePlayer } from "@sophistry/solidjs";
import { Bars, Chart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Grouped and stacked bars",
	description:
		"One long-format table, two layouts of one bar mark: series colours the regions through the chart's scale and legend, the dodge layout puts them side by side in each quarter, the stack layout piles them up. The stack grows as one, so every frame is a true stacked chart.",
};

const sales = ["Q1", "Q2", "Q3", "Q4"].flatMap((quarter, q) =>
	["north", "south", "east"].map((region, r) => ({
		quarter,
		region,
		units: [
			[4, 6, 5, 8],
			[3, 3, 4, 5],
			[2, 4, 3, 4],
		][r][q],
	})),
);
const palette = ["#4c78a8", "#f58518", "#54a24b"];

export default function GroupedAndStackedBars() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	return (
		<Stage units={16}>
			<Chart
				width={6}
				height={4}
				center={{ x: -4, y: 0 }}
				grid="y"
				color={{ range: palette }}
				legend="top"
				progress={shown}
			>
				<Bars
					data={sales}
					category="quarter"
					value="units"
					series="region"
					layout="dodge"
					stagger={0.4}
				/>
			</Chart>
			<Chart
				width={6}
				height={4}
				center={{ x: 4, y: 0 }}
				grid="y"
				color={{ range: palette }}
				legend="top"
				progress={shown}
			>
				<Bars
					data={sales}
					category="quarter"
					value="units"
					series="region"
					layout="stack"
				/>
			</Chart>
			<Label text="dodge" x={-4} y={-3.2} fontSize={0.4} />
			<Label text="stack" x={4} y={-3.2} fontSize={0.4} />
		</Stage>
	);
}
