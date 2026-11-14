import { draw, track } from "@sophistry/core";
import { Stage, Text, usePlayer } from "@sophistry/solidjs";
import { Beeswarm, Chart, Strip } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Strip plot and beeswarm",
	description:
		"Every observation as a dot, coloured by cohort through the chart's series scale and legend. A strip plot spreads them by seeded jitter (the same on every frame); a beeswarm packs them so none overlap. Dots appear in place, low values first.",
};

const arms = ["placebo", "low dose", "high dose"];
const trials = arms.flatMap((arm, a) =>
	Array.from({ length: 30 }, (_, i) => {
		const u =
			(Math.sin((i + 1) * 12.9898 + a * 7.1) + Math.sin((i + 1) * 4.1414)) / 2;
		const cohort = i % 3 === 0 ? "2025" : "2024";
		return { arm, cohort, response: 40 + a * 8 + u * 12 };
	}),
);

export default function StripAndSwarm() {
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
				legend="top"
				progress={shown}
			>
				<Strip
					data={trials}
					category="arm"
					value="response"
					series="cohort"
					stagger={0.6}
				/>
			</Chart>
			<Chart
				width={6}
				height={4}
				center={{ x: 4, y: 0 }}
				grid="y"
				legend="top"
				progress={shown}
			>
				<Beeswarm
					data={trials}
					category="arm"
					value="response"
					series="cohort"
					radius={0.06}
					stagger={0.6}
				/>
			</Chart>
			<Text text="Strip" x={-4} y={-3.2} fontSize={0.4} />
			<Text text="Beeswarm" x={4} y={-3.2} fontSize={0.4} />
		</Stage>
	);
}
