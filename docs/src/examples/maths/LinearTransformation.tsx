import { hold, track, valueTo } from "@sophistry/core";
import { linearMap } from "@sophistry/core/geometry";
import {
	BasisVectors,
	LinearTransform,
	NumberPlane,
	Polygon,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Linear transformation",
	description:
		"A shear matrix warps the plane and a unit square, while the basis vectors show where each column of the matrix lands.",
	uses: [
		"Stage",
		"NumberPlane",
		"LinearTransform",
		"BasisVectors",
		"Polygon",
		"linearMap",
		"track",
		"valueTo",
		"usePlayer",
		"hold",
	],
};

const SHEAR = linearMap([
	[1, 1],
	[0, 1],
]);
const SQUARE = [
	{ x: 0, y: 0 },
	{ x: 1, y: 0 },
	{ x: 1, y: 1 },
	{ x: 0, y: 1 },
];

export default function LinearTransformation() {
	const { play, signal } = usePlayer();
	const t = track(0);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(hold(0.8));
				await play(valueTo(t, 1, { duration: 2.5 }));
				await play(hold(1));
				await play(valueTo(t, 0, { duration: 2.5 }));
			}
		})();
	});

	return (
		<Stage units={14}>
			<NumberPlane
				xRange={[-4, 4]}
				yRange={[-3, 3]}
				width={8}
				height={6}
				gridOpacity={0.15}
			/>
			<LinearTransform matrix={SHEAR} progress={t}>
				<NumberPlane xRange={[-4, 4]} yRange={[-3, 3]} width={8} height={6} />
				<Polygon points={SQUARE} fill="#58c4dd" fillOpacity={0.4} />
			</LinearTransform>
			<BasisVectors matrix={SHEAR} progress={t} labels />
		</Stage>
	);
}
