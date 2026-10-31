import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Bullet } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Bullet chart",
	description:
		"Stephen Few's bullet graph: four KPIs against their targets over poor / fair / good bands, each on its own scale. The bands fade in first, then each bar grows from zero and its target marker draws in.",
	uses: ["Stage", "Bullet", "track", "draw", "usePlayer"],
};

const kpis = [
	{ name: "Revenue ($k)", actual: 270, goal: 250, bands: [150, 225, 300] },
	{ name: "Profit (%)", actual: 22.5, goal: 27, bands: [20, 25, 30] },
	{ name: "Order size ($)", actual: 320, goal: 550, bands: [350, 500, 600] },
	{ name: "Satisfaction", actual: 4.3, goal: 4.5, bands: [3.5, 4.25, 5] },
];

export default function BulletChart() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<Bullet
				data={kpis}
				value="actual"
				target="goal"
				ranges="bands"
				label="name"
				width={10.5}
				height={5}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
