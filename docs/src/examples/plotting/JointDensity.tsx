import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { JointPlot } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Scatter with marginal densities",
	description:
		"A joint plot: two groups in a scatter, with each variable's density along its edge, the right-hand one a vertical density, values up y. The marginals follow the scatter's scales, so the curves line up with the points, and they are normalised together, so each curve's area is its group's share and the larger group stands taller.",
	uses: ["Stage", "JointPlot", "track", "draw", "usePlayer"],
};

// Two blobs from a deterministic sine hash.
const hash = (n: number) => (Math.sin(n * 12.9898) * 43758.5453) % 1;
const points = Array.from({ length: 90 }, (_, i) => {
	const big = i < 60;
	return {
		group: big ? "many" : "few",
		x: (big ? 3 : 6) + 1.1 * (hash(i + 1) + hash(i + 101)),
		y: (big ? 4 : 2) + 0.9 * (hash(i + 201) + hash(i + 301)),
	};
});

export default function JointDensity() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<JointPlot
				data={points}
				x="x"
				y="y"
				series="group"
				width={8.4}
				height={5.4}
				center={{ x: 0, y: 0.2 }}
				ratio={4}
				radius={0.06}
				xRange={[0, 9]}
				yRange={[0, 7]}
				progress={shown}
			/>
		</Stage>
	);
}
