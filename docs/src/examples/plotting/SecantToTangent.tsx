import { derive, track, valueTo } from "@sophistry/core";
import {
	Axes,
	FunctionGraph,
	Label,
	SecantSlopeGroup,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Secant to tangent",
	description:
		"Shrink dx toward zero and the secant line through two points turns into the tangent.",
};

const f = (x: number) => (x * x) / 6;

export default function SecantToTangent() {
	const { play } = usePlayer();
	const dx = track(2.5);

	onSettled(() => {
		void play(valueTo(dx, 0.01, { duration: 4 }));
	});

	return (
		<Stage units={14}>
			<Axes xRange={[0, 6]} yRange={[0, 6]} width={9} height={6}>
				<FunctionGraph function={f} />
				<SecantSlopeGroup function={f} x={3} dx={dx} length={4} />
			</Axes>
			<Label text={derive(dx, (value) => `dx = ${value.toFixed(2)}`)} y={3.5} />
		</Stage>
	);
}
