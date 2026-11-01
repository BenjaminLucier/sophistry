import { Stage } from "@sophistry/solidjs";
import { Chart, FillBetween, LinePlot } from "@sophistry/solidjs/charts";

export const meta = {
	title: "Time series",
	description:
		"Native Dates make a UTC time axis that ticks on month boundaries and writes dates.",
};

const months = [
	4.1, 4.6, 6.8, 9.9, 13.2, 16.4, 18.1, 17.8, 15.2, 11.3, 7.4, 4.9,
];
const temps = months.map((celsius, m) => ({
	t: new Date(Date.UTC(2024, m, 15)),
	celsius,
}));

export default function TimeSeries() {
	return (
		<Stage units={12}>
			<Chart width={9} height={4.5} yLabel="°C" grid="y">
				<FillBetween data={temps} x="t" y1="celsius" />
				<LinePlot data={temps} x="t" y="celsius" />
			</Chart>
		</Stage>
	);
}
