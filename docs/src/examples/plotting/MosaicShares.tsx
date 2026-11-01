import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Mosaic } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Mosaic (Marimekko) chart",
	description:
		"Sales by region × product: each column is as wide as its region's share of the market, split by product mix, so every tile's area is its sales. Region names fade in first, then the columns grow left to right.",
};

const regions = {
	Americas: [42, 30, 18],
	Europe: [25, 28, 12],
	Asia: [20, 14, 26],
};
const products = ["Phones", "Laptops", "Tablets"];
const sales = Object.entries(regions).flatMap(([region, units]) =>
	units.map((n, k) => ({ region, product: products[k], units: n })),
);

export default function MosaicShares() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 2.5 }));
	});

	return (
		<Stage units={10}>
			<Mosaic
				data={sales}
				x="region"
				y="product"
				value="units"
				width={8}
				height={4}
				center={{ x: 0, y: 0.4 }}
				shares
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
