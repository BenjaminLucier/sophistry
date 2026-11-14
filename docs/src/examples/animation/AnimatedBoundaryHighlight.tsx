import { rectPolyline } from "@sophistry/core/geometry";
import { AnimatedBoundary, Stage, Text } from "@sophistry/solidjs";

export const meta = {
	title: "Animated boundary",
	description:
		"A stroke keeps running round a box, a new colour each cycle, while the last one thins away underneath: ambient emphasis that needs no animation.",
};

export default function AnimatedBoundaryHighlight() {
	return (
		<Stage units={8}>
			<Text text="the key step" fontSize={0.5} />
			<AnimatedBoundary
				points={rectPolyline(-2, -0.6, 4, 1.2, 0.2)}
				strokeWidth={0.06}
				cycleRate={0.6}
			/>
		</Stage>
	);
}
