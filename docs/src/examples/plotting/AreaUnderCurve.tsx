import { derive, track, valueTo } from "@sophistry/core";
import {
	AreaUnderGraph,
	Axes,
	FunctionGraph,
	Text,
	RiemannRectangles,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Area under a curve",
	description:
		"Riemann rectangles are stacked ever more thinly until they fill the area under the curve.",
};

const f = (x: number) => (x * x) / 6;

export default function AreaUnderCurve() {
	const { play } = usePlayer();
	const count = track(3);

	onSettled(() => {
		void play(valueTo(count, 60, { duration: 4 }));
	});

	return (
		<Stage units={14}>
			<Axes xRange={[0, 6]} yRange={[0, 6]} width={9} height={6}>
				<AreaUnderGraph function={f} from={1} to={5} fillOpacity={0.2} />
				<RiemannRectangles
					function={f}
					from={1}
					to={5}
					count={count}
					sample="midpoint"
				/>
				<FunctionGraph function={f} />
			</Axes>
			<Text
				text={derive(count, (value) => `${Math.round(value)} rectangles`)}
				y={3.5}
			/>
		</Stage>
	);
}
