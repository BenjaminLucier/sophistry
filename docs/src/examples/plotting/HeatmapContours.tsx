import { draw, track } from "@sophistry/core";
import { Axes, Stage, usePlayer } from "@sophistry/solidjs";
import { Contour, Imshow } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Heatmap with contours",
	description:
		"A grid of values colored as a heatmap, with iso-lines of the same field drawn over it.",
};

const x = Array.from({ length: 31 }, (_, i) => -3 + i * 0.2);
const y = Array.from({ length: 21 }, (_, i) => -2 + i * 0.2);
const z = y.map((yy) => x.map((xx) => Math.sin(xx) * Math.cos(yy * 1.5)));

export default function HeatmapContours() {
	const { play } = usePlayer();
	const lines = track(0);

	onSettled(() => {
		void play(draw(lines, { duration: 2 }));
	});

	return (
		<Stage units={12}>
			<Axes
				xRange={[-3.1, 3.1, 1]}
				yRange={[-2.1, 2.1, 1]}
				width={9}
				height={5.5}
				zIndex={5}
				// A halo keeps the numbers clear of the white contours running under them.
				axis={{ stroke: "white", numberHalo: true }}
			>
				<Imshow
					values={z}
					xRange={[-3.1, 3.1]}
					yRange={[-2.1, 2.1]}
					rowOrigin="lower"
					ramp="viridis"
				/>
				<Contour xs={x} ys={y} values={z} stroke="white" progress={lines} />
			</Axes>
		</Stage>
	);
}
