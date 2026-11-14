import { derive, hold, track, valueTo } from "@sophistry/core";
import {
	ComplexPlane,
	LabeledDot,
	Stage,
	Text,
	usePlayer,
	Vector,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Complex multiplication",
	description:
		"Multiplying z by 1 + i turns it by 45 degrees and stretches it by the square root of 2, which is the argument and modulus of 1 + i.",
};

// z = 1 + 0.5i is multiplied by w = 1 + i, whose modulus is sqrt(2) and
// argument is 45 degrees. t = 0..1 applies that rotation and scaling gradually.
const Z = { x: 1, y: 0.5 };
const ARG_W = Math.PI / 4;

export default function ComplexMultiplication() {
	const { play, signal } = usePlayer();
	const t = track(0);
	const zw = derive(t, (t) => {
		const scale = Math.SQRT2 ** t;
		const [cos, sin] = [Math.cos(t * ARG_W), Math.sin(t * ARG_W)];
		return {
			x: scale * (Z.x * cos - Z.y * sin),
			y: scale * (Z.x * sin + Z.y * cos),
		};
	});
	const moved = derive(t, (t) => t > 0.02);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(hold(1));
				await play(valueTo(t, 1, { duration: 2.5 }));
				await play(hold(1.5));
				await play(valueTo(t, 0, { duration: 1.5 }));
			}
		})();
	});

	return (
		<Stage units={12}>
			<ComplexPlane xRange={[-3, 3]} yRange={[-3, 3]} width={6} height={6} />
			<Vector to={zw} visible={moved} />
			<LabeledDot center={zw} text="z·w" visible={moved} />
			<Vector to={Z} />
			<LabeledDot center={Z} text="z" />
			<Text text="w = 1 + i" x={-4.3} y={2} />
		</Stage>
	);
}
