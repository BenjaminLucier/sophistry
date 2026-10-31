import type { Clock, Point, ShapeProps } from "@sophistry/core";
import {
	createScene,
	defineShape,
	draw,
	Invalidate,
	parallel,
	sequence,
	shapeProps,
	track,
	valueTo,
} from "@sophistry/core";

export const meta = {
	title: "A custom shape with defineShape",
	description:
		"defineShape turns a props descriptor and a geometry function into a definition like circle; the new rose shape is created, drawn and animated.",
	uses: [
		"defineShape",
		"shapeProps",
		"Stage",
		"createScene",
		"track",
		"draw",
		"valueTo",
		"parallel",
		"sequence",
	],
};

interface RoseProps extends ShapeProps {
	center?: Point;
	/** Number of petals (an odd count draws as many, an even one twice as many). */
	petals: number;
	size: number;
}

// Each prop names the cheapest stage it invalidates: a move is a new matrix, never a new outline.
const rose = defineShape<RoseProps>({
	name: "Rose",
	props: {
		...shapeProps,
		center: { invalidates: Invalidate.TRANSFORM, instanceable: true },
		petals: { invalidates: Invalidate.GEOMETRY },
		size: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	},
	geometry: ({ petals, size }) => ({
		closed: true,
		polylines: [
			Array.from({ length: 360 }, (_, i) => {
				const t = (i / 360) * 2 * Math.PI;
				const radius = size * Math.cos(petals * t);
				return { x: radius * Math.cos(t), y: radius * Math.sin(t) };
			}),
		],
	}),
	offset: (props) => props.center,
});

export default function mount(host: HTMLElement, clock?: Clock): () => void {
	const scene = createScene({ host, clock, units: 10 });
	const drawn = track(0);
	const size = track(1.5);
	const rotation = track(0);
	scene.add(
		rose.create({
			petals: 5,
			size,
			progress: drawn,
			rotation,
			stroke: "#cba6f7",
			fill: "#cba6f7",
			fillOpacity: 0.2,
		}),
	);
	void scene.play(
		sequence(
			draw(drawn, { duration: 2 }),
			parallel(
				valueTo(size, 2.6, { duration: 1.2 }),
				valueTo(rotation, Math.PI / 5, { duration: 1.2 }),
			),
		),
	);
	return () => scene.dispose();
}
