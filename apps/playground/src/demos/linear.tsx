import { track, valueTo } from "@sophistry/core";
import { linearMap } from "@sophistry/core/geometry";
import {
	BasisVectors,
	Dot,
	LinearTransform,
	NumberPlane,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

// A shear: î stays, ĵ leans right. `linearMap` takes rows.
const SHEAR = linearMap([
	[1, 1],
	[0, 1],
]);

/**
 * A ghost grid stays put, the live grid and the
 * dot inside `<LinearTransform>` shear in lockstep, and `<BasisVectors>`
 * reports the map from outside it.
 */
export function LinearDemo() {
	const t = track(0);
	const player = usePlayer();

	onSettled(() => {
		void (async () => {
			await player.play(valueTo(t, 1, { duration: 2.5 }));
			await player.play(valueTo(t, 0, { duration: 2.5 }));
		})();
	});

	return (
		<Stage units={12}>
			<NumberPlane
				xRange={[-4, 4]}
				yRange={[-3, 3]}
				width={9}
				height={6.75}
				gridOpacity={0.15}
			/>
			<LinearTransform matrix={SHEAR} progress={t}>
				<NumberPlane
					xRange={[-4, 4]}
					yRange={[-3, 3]}
					width={9}
					height={6.75}
				/>
				<Dot center={{ x: 2, y: 1 }} color="#00ffb7" />
			</LinearTransform>
			<BasisVectors matrix={SHEAR} progress={t} labels />
		</Stage>
	);
}
