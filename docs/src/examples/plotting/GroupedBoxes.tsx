import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { BoxPlot, Strip } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Grouped box plots",
	description:
		"Box plots split by a series, seaborn's hue: the boxes sharing a dose stand side by side in its slot, and a dodged strip of the raw readings sits over each box. One colour scale and one legend serve both.",
	uses: ["Stage", "BoxPlot", "Strip", "track", "draw", "usePlayer"],
};

const doses = ["low", "mid", "high"];
const arms = ["placebo", "drug"];
// Raw readings: 14 per dose and arm, from a deterministic sine hash.
const readings = doses.flatMap((dose, d) =>
	arms.flatMap((arm, a) =>
		Array.from({ length: 14 }, (_, i) => ({
			dose,
			arm,
			score:
				40 + a * (6 + 6 * d) + 9 * Math.sin((i + 1) * (d + 2) * (a + 3) * 1.7),
		})),
	),
);
// The same readings, one sample per box.
const groups = doses.flatMap((dose) =>
	arms.map((arm) => ({
		dose,
		arm,
		scores: readings
			.filter((r) => r.dose === dose && r.arm === arm)
			.map((r) => r.score),
	})),
);

export default function GroupedBoxes() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<BoxPlot
				data={groups}
				values="scores"
				label="dose"
				series="arm"
				fillOpacity={0.35}
				width={7}
				height={4.2}
				center={{ x: -0.6, y: 0 }}
				yRange={[20, 80, 10]}
				stagger={0.4}
				progress={shown}
			>
				<Strip
					data={readings}
					category="dose"
					value="score"
					series="arm"
					dodge
					width={0.5}
					radius={0.045}
				/>
			</BoxPlot>
		</Stage>
	);
}
