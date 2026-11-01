import type { CoordinateSystem, Point, SceneNode } from "@sophistry/core";
import {
	coordsReadable,
	derive,
	GOLD,
	hold,
	moveTo,
	track,
	trackPoint,
} from "@sophistry/core";
import {
	AnnotationDot,
	Axes,
	Path,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { Contour } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Gradient descent",
	description:
		"A point rolls down the contours of f(x, y) = (x^2 + 6y^2) / 2, zig-zagging across the narrow valley and leaving a trail.",
};

const START = { x: -2.6, y: 1.2 };
const RATE = 0.28;
const X = Array.from({ length: 61 }, (_, i) => -3 + i * 0.1);
const Y = Array.from({ length: 41 }, (_, i) => -2 + i * 0.1);
const Z = Y.map((y) => X.map((x) => (x * x + 6 * y * y) / 2));

/** Data coordinates to scene units, through the axes' coordinate system. */
const toScene = (coords: CoordinateSystem | null, p: Point) =>
	coords?.coordsToPoint(p.x, p.y) ?? { x: 0, y: 0 };

export default function GradientDescent() {
	const { play, signal } = usePlayer();
	const pos = trackPoint(START.x, START.y);
	const trail = track<Point[]>([START]);
	let axes!: SceneNode;

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				pos.set(START);
				trail.set([START]);
				await play(hold(0.8));
				for (let step = 0; step < 14; step++) {
					const { x, y } = pos.peek();
					// The gradient of f is (x, 6y).
					const next = { x: x - RATE * x, y: y - RATE * 6 * y };
					await play(moveTo(pos, next, { duration: 0.45 }));
					trail.set([...trail.peek(), next]);
				}
				await play(hold(1.5));
			}
		})();
	});

	return (
		<Stage units={12}>
			<Axes
				ref={(node) => {
					axes = node;
				}}
				xRange={[-3, 3, 1]}
				yRange={[-2, 2, 1]}
				width={7.5}
				height={5}
			>
				<Contour xs={X} ys={Y} values={Z} levels={8} />
			</Axes>
			{/* The axes are made first, so `axes` is set by the time these props are. */}
			<Path
				points={derive(
					[coordsReadable(axes), trail, pos],
					(coords, trail, pos) =>
						[...trail, pos].map((p) => toScene(coords, p)),
				)}
				stroke={GOLD}
			/>
			<AnnotationDot center={derive([coordsReadable(axes), pos], toScene)} />
		</Stage>
	);
}
