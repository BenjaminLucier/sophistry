import { derive, track, valueTo } from "@sophistry/core";
import { Label, Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, Scatter } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Animated scatter with trails",
	description:
		"Time as an encoding, Gapminder-style: one marker per country at the moment `at`, sized by population (area ∝ value, the `size` channel) and interpolated between decades, with a trail of the path it took. The axes fit every decade, so they hold still while time plays.",
};

const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020];
const COUNTRIES = [
	{ name: "A", region: "Asia", income: 600, growth: 1.42, life: 42, pop: 9 },
	{ name: "B", region: "Asia", income: 900, growth: 1.25, life: 48, pop: 7 },
	{ name: "C", region: "Africa", income: 1100, growth: 1.1, life: 41, pop: 4 },
	{ name: "D", region: "Africa", income: 450, growth: 1.12, life: 36, pop: 3 },
	{ name: "E", region: "Europe", income: 9000, growth: 1.22, life: 69, pop: 2 },
	{
		name: "F",
		region: "Americas",
		income: 4000,
		growth: 1.16,
		life: 58,
		pop: 5,
	},
];
const rows = COUNTRIES.flatMap((c) =>
	DECADES.map((year, k) => ({
		country: c.name,
		region: c.region,
		year,
		income: Math.round(c.income * c.growth ** k),
		life: Math.min(
			84,
			c.life + k * (5.5 - c.life / 20) + 2 * Math.sin(k + c.pop),
		),
		pop: c.pop * (1 + 0.25 * k),
	})),
);

export default function AnimatedScatterTrails() {
	const { play } = usePlayer();
	const year = track(DECADES[0]);
	onSettled(() => {
		void play(valueTo(year, 2020, { duration: 8, easing: "linear" }));
	});

	return (
		<Stage units={12}>
			<Chart
				width={10}
				height={4.6}
				center={{ x: 0, y: -0.2 }}
				grid
				xAxis={{ scale: "log", tickFormat: "$,.0f" }}
				xLabel="income"
				yLabel="life"
			>
				<Scatter
					data={rows}
					x="income"
					y="life"
					key="country"
					series="region"
					time="year"
					at={year}
					size="pop"
					sizeRange={[0.06, 0.32]}
					trail
					fillOpacity={0.85}
				/>
			</Chart>
			<Label
				text={derive(year, (time) => String(Math.floor(time)))}
				x={1.9}
				y={-1.8}
				fontSize={0.9}
				opacity={0.45}
			/>
		</Stage>
	);
}
