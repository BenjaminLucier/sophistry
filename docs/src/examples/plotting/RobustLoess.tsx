import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, Regression, Scatter } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Robust LOESS smooth",
	description:
		"A local regression with its 95% band, through a noisy daily series with a few bad readings. The plain smooth bends toward the outliers and its band balloons; robustness iterations re-weight them away.",
	uses: [
		"Stage",
		"Chart",
		"Regression",
		"Scatter",
		"track",
		"draw",
		"usePlayer",
	],
};

const readings = Array.from({ length: 60 }, (_, day) => {
	const trend = 10 + 6 * Math.sin(day / 9);
	const noise = 1.2 * Math.sin((day + 1) * 12.9898);
	const glitch = day % 17 === 8 ? 14 : 0;
	return { day, value: trend + noise + glitch };
});

export default function RobustLoess() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<Chart
				width={8}
				height={4.2}
				center={{ x: -0.6, y: -0.2 }}
				xLabel="day"
				grid="y"
				color={{ domain: ["plain", "robust"] }}
				progress={shown}
			>
				<Regression
					data={readings}
					x="day"
					y="value"
					method="loess"
					bandwidth={0.35}
					series={() => "plain"}
				/>
				<Regression
					data={readings}
					x="day"
					y="value"
					method="loess"
					bandwidth={0.35}
					robust
					series={() => "robust"}
				/>
				<Scatter
					data={readings}
					x="day"
					y="value"
					radius={0.05}
					color="#9aa0a6"
				/>
			</Chart>
		</Stage>
	);
}
