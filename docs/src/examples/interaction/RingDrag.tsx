import { draggable, onCircle, trackPoint } from "@sophistry/core";
import {
	Circle,
	InteractionGroup,
	LabeledDot,
	Stage,
	Text,
	useTheme,
} from "@sophistry/solidjs";

export const meta = {
	title: "Drag along a ring",
	description:
		"A dot constrained to a circle, draggable with the pointer or the arrow keys.",
};

export default function RingDrag() {
	const theme = useTheme();
	const position = trackPoint(0, 2);
	const ring = draggable(position, { constrain: onCircle({ x: 0, y: 0 }, 2) });

	return (
		<Stage units={10}>
			<Circle
				center={{ x: 0, y: 0 }}
				radius={2}
				stroke={theme().palette.grid}
				dash={[0.15, 0.15]}
				strokeWidth={0.04}
			/>
			<InteractionGroup {...ring}>
				<LabeledDot center={position} text="drag" />
			</InteractionGroup>
			<Text
				text="drag the dot, or Tab to it and use the arrow keys"
				y={-2.5}
				color={theme().palette.muted}
				fontSize={0.28}
			/>
		</Stage>
	);
}
