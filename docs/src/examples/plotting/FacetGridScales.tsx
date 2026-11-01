import { scatter } from "@sophistry/charts";
import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Facet } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Facet grid with x shared down each column",
	description:
		'scales={{ x: "column" }} gives each travel mode its own distance axis, shared by the rows below it (ggplot\'s facet_grid with scales = "free_x"), and space="free" sizes each column by its range, so a kilometre is one length across the grid. Time stays shared.',
};

const hash = (n: number) => Math.abs(Math.sin(n * 78.233) * 43758.5453) % 1;
const modes = [
	{ mode: "walk", far: 5, speed: 5 },
	{ mode: "bike", far: 12, speed: 16 },
	{ mode: "bus", far: 20, speed: 22 },
];
const trips = modes.flatMap(({ mode, far, speed }, m) =>
	["weekday", "weekend"].flatMap((day, d) =>
		Array.from({ length: 14 }, (_, i) => {
			const km = 0.5 + (far - 0.5) * hash(i + 31 * m + 7 * d);
			return {
				mode,
				day,
				km,
				min: (km / speed) * 60 * (d ? 1.2 : 1) + 4 * hash(i + 90),
			};
		}),
	),
);

export default function FacetGridScales() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2 }));
	});

	return (
		<Stage units={12}>
			<Facet
				data={trips}
				row="day"
				column="mode"
				scales={{ x: "column" }}
				space={{ x: "free" }}
				width={10.6}
				height={5.4}
				center={{ x: -0.1, y: -0.1 }}
				// The size is the whole grid, numbers and titles included.
				autosize="contain"
				xLabel="distance (km)"
				yLabel="time (min)"
				progress={shown}
				panel={(panel) => [
					scatter.create({ data: panel.data, x: "km", y: "min", radius: 0.05 }),
				]}
			/>
		</Stage>
	);
}
