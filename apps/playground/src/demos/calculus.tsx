import { track, valueTo } from "@sophistry/core";
import {
	AreaUnderGraph,
	Axes,
	FunctionGraph,
	RiemannRectangles,
	SecantSlopeGroup,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

const f = (x: number) => (x * x) / 6;

/**
 * Shade the area, stack Riemann rectangles
 * while their count runs up, then walk a secant into a tangent by animating
 * `dx` towards zero.
 */
export function CalculusDemo() {
	const area = track(0);
	const count = track(4);
	const dx = track(2);
	const player = usePlayer();

	onSettled(() => {
		void (async () => {
			await player.play(valueTo(area, 1, { duration: 1.2 }));
			await player.play(valueTo(count, 40, { duration: 2 }));
			await player.play(valueTo(dx, 0.01, { duration: 2 }));
		})();
	});

	return (
		<Stage units={12}>
			<Axes xRange={[0, 6]} yRange={[0, 6]} width={9} height={6}>
				<FunctionGraph function={f} />
				<AreaUnderGraph
					function={f}
					from={1}
					to={5}
					progress={area}
					fill="#416bbe"
					fillOpacity={0.35}
				/>
				<RiemannRectangles
					function={f}
					from={1}
					to={5}
					count={count}
					fill="#00ffb7"
					fillOpacity={0.4}
				/>
				<SecantSlopeGroup function={f} x={3} dx={dx} />
			</Axes>
		</Stage>
	);
}
