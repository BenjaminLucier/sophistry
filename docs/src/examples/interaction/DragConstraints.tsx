import { draggable, onCircle, snapToGrid, trackPoint } from "@sophistry/core";
import { Circle, Dot, Stage, Text, useTheme } from "@sophistry/solidjs";

export const meta = {
	title: "Drag constraints",
	description:
		"Three dots with three rules: one moves freely, one is pinned to a circle, and one snaps to a grid of 0.5 units.",
};

export default function DragConstraints() {
	const theme = useTheme();
	const palette = () => theme().palette;
	const free = trackPoint(-4, 0.5);
	const ring = trackPoint(0, 1.5);
	const grid = trackPoint(4, 0.5);

	const freeDrag = draggable(free);
	const ringDrag = draggable(ring, {
		constrain: onCircle({ x: 0, y: 0 }, 1.5),
	});
	const gridDrag = draggable(grid, { constrain: snapToGrid(0.5) });

	return (
		<Stage units={12}>
			<Circle
				center={{ x: 0, y: 0 }}
				radius={1.5}
				stroke={palette().grid}
				dash={[0.15, 0.15]}
			/>
			<Dot center={free} radius={0.2} label="free" {...freeDrag} />
			<Dot
				center={ring}
				radius={0.2}
				color={palette().series[1]}
				label="on a circle"
				{...ringDrag}
			/>
			<Dot
				center={grid}
				radius={0.2}
				color={palette().series[2]}
				label="snapped to a grid"
				{...gridDrag}
			/>
			<Text text="free" x={-4} y={-2} color={palette().muted} fontSize={0.35} />
			<Text
				text="onCircle"
				x={0}
				y={-2}
				color={palette().muted}
				fontSize={0.35}
			/>
			<Text
				text="snapToGrid"
				x={4}
				y={-2}
				color={palette().muted}
				fontSize={0.35}
			/>
			<Text
				text="drag the dots"
				y={-3}
				color={palette().muted}
				fontSize={0.3}
			/>
		</Stage>
	);
}
