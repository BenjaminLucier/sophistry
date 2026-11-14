import { derive, draggable, toBounds, trackPoint } from "@sophistry/core";
import { Dot, Rect, Stage, Text, useTheme } from "@sophistry/solidjs";

export const meta = {
	title: "Keyboard-accessible dragging",
	description:
		"Every draggable is also a tab stop. Tab to the dot, then use the arrow keys to move it by 0.5 units (hold Shift for 0.1), or Escape to cancel a drag in progress.",
};

export default function KeyboardAccessible() {
	const theme = useTheme();
	const palette = () => theme().palette;
	const box = { minX: -3, maxX: 3, minY: -1.5, maxY: 1.5 };
	const position = trackPoint(0, 0);
	const handle = draggable(position, {
		constrain: toBounds(box, { half: 0.2 }),
		step: 0.5,
		fineStep: 0.1,
	});

	return (
		<Stage units={10}>
			<Rect width={6} height={3} stroke={palette().grid} />
			<Dot center={position} radius={0.2} label="point" {...handle} />
			<Text
				text={derive(
					position,
					({ x, y }) => `(${x.toFixed(1)}, ${y.toFixed(1)})`,
				)}
				y={2.1}
				color={palette().muted}
			/>
			<Text
				text="Tab to focus, then arrow keys (Shift = fine)"
				y={-2.4}
				color={palette().muted}
				fontSize={0.28}
			/>
		</Stage>
	);
}
