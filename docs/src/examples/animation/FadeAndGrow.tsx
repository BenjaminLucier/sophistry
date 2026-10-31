import {
	fadeIn,
	fadeOut,
	growFromCenter,
	hold,
	parallel,
	shrinkToCenter,
	spinInFromNothing,
	track,
} from "@sophistry/core";
import { starPolygon } from "@sophistry/core/geometry";
import {
	Circle,
	Label,
	Polygon,
	Square,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Fade and grow",
	description:
		"Three shapes enter in different ways: fading in, growing from their center, and spinning in from nothing.",
	uses: [
		"Stage",
		"Circle",
		"Square",
		"Polygon",
		"Label",
		"track",
		"fadeIn",
		"fadeOut",
		"growFromCenter",
		"shrinkToCenter",
		"spinInFromNothing",
		"starPolygon",
		"parallel",
		"hold",
		"usePlayer",
	],
};

export default function FadeAndGrow() {
	const { play, signal } = usePlayer();
	const opacity = track(0);
	const grow = track(1);
	const spin = track(1);
	const turn = track(0);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					parallel(
						fadeIn(opacity),
						growFromCenter(grow),
						spinInFromNothing(spin, turn),
					),
				);
				await play(hold(1.2));
				await play(
					parallel(
						fadeOut(opacity),
						shrinkToCenter(grow),
						shrinkToCenter(spin),
					),
				);
				await play(hold(0.6));
				// Back to full size only now, just before they grow again: reset
				// before the hold, they would pop back for its length.
				grow.set(1);
				spin.set(1);
			}
		})();
	});

	return (
		<Stage units={12}>
			<Circle center={{ x: -4, y: 0 }} radius={1} opacity={opacity} />
			<Square center={{ x: 0, y: 0 }} size={1.8} scale={grow} />
			<Polygon
				points={starPolygon(4, 0, 1.1, 0.5, 5)}
				scale={spin}
				rotation={turn}
			/>
			<Label text="fadeIn" x={-4} y={-2} />
			<Label text="growFromCenter" x={0} y={-2} />
			<Label text="spinInFromNothing" x={4} y={-2} />
		</Stage>
	);
}
