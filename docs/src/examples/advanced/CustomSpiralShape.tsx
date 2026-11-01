import type { Point, ShapeProps } from "@sophistry/core";
import {
	defineShape,
	derive,
	draw,
	Invalidate,
	shapeProps,
	track,
} from "@sophistry/core";
import { Stage, usePlayer, useScene, wrap } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "A custom shape: Spiral",
	description:
		"A new primitive in a dozen lines. defineShape takes the props and a geometry function, so it gets styling, transforms, gradients, draw() and paint order like any built-in; wrap() makes it a component.",
};

interface SpiralProps extends ShapeProps {
	center?: Point;
	/** Radius after `turns` full turns, in scene units. */
	radius: number;
	turns?: number;
}

/**
 * An Archimedean spiral: radius grows linearly with the angle. Each prop says
 * which stage of the shape's pipeline it invalidates (core's `Invalidate` bits).
 */
const spiral = defineShape<SpiralProps>({
	name: "Spiral",
	props: {
		...shapeProps,
		center: { invalidates: Invalidate.GEOMETRY },
		radius: { default: 1, invalidates: Invalidate.GEOMETRY },
		turns: { default: 3, invalidates: Invalidate.GEOMETRY },
	},
	geometry: (props) => {
		const turns = props.turns ?? 3;
		const steps = Math.ceil(turns * 48);
		const points = Array.from({ length: steps + 1 }, (_, i) => {
			const u = i / steps;
			const angle = u * turns * Math.PI * 2;
			return {
				x: (props.center?.x ?? 0) + props.radius * u * Math.cos(angle),
				y: (props.center?.y ?? 0) + props.radius * u * Math.sin(angle),
			};
		});
		return { polylines: [points], closed: false };
	},
});
const Spiral = wrap(spiral);

function Spirals() {
	const theme = useScene().theme;
	const { play } = usePlayer();
	const drawn = track(0);

	onSettled(() => {
		void play(draw(drawn, { duration: 3 }));
	});

	return (
		<>
			<Spiral
				center={{ x: -2.6, y: 0 }}
				radius={2.2}
				turns={3}
				progress={drawn}
				stroke={derive(theme, (t) => t.palette.series[0])}
				strokeWidth={0.07}
			/>
			<Spiral
				center={{ x: 2.6, y: 0 }}
				radius={2.2}
				turns={5}
				progress={drawn}
				rotation={derive(drawn, (drawn) => drawn * Math.PI)}
				stroke={derive(theme, (t) => t.palette.series[1])}
				strokeWidth={0.05}
				dash={[0.2, 0.12]}
			/>
		</>
	);
}

export default function CustomSpiralShape() {
	return (
		<Stage units={10}>
			<Spirals />
		</Stage>
	);
}
