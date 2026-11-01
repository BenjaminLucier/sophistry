import { draggable, dropTarget, trackPoint } from "@sophistry/core";
import { Circle, Label, Rect, Stage, useTheme } from "@sophistry/solidjs";
import { createSignal } from "solid-js";

export const meta = {
	title: "Drop targets",
	description:
		"Drag the token onto either box. Each box lights up while the token is over it, and the choice is reported when you let go.",
};

export default function DropTargets() {
	const theme = useTheme();
	const palette = () => theme().palette;
	const home = { x: 0, y: -1.6 };
	const token = trackPoint(home.x, home.y);
	// Written by the drop targets on user input, so plain Solid signals.
	const [overLeft, setOverLeft] = createSignal(false);
	const [overRight, setOverRight] = createSignal(false);
	const [chosen, setChosen] = createSignal("nothing yet");

	const drag = draggable(token, { onDragEnd: () => token.set(home) });
	const zone = (over: (value: boolean) => void, name: string) =>
		dropTarget({ over, onDrop: () => setChosen(name) });

	return (
		<Stage units={10}>
			<Rect
				center={{ x: -2.5, y: 0.8 }}
				width={3}
				height={2}
				cornerRadius={0.2}
				fill={overLeft() ? palette().highlight : palette().surface}
				{...zone(setOverLeft, "left box")}
			/>
			<Rect
				center={{ x: 2.5, y: 0.8 }}
				width={3}
				height={2}
				cornerRadius={0.2}
				fill={overRight() ? palette().highlight : palette().surface}
				{...zone(setOverRight, "right box")}
			/>
			<Label
				text="left box"
				x={-2.5}
				y={0.8}
				color={palette().muted}
				fontSize={0.35}
			/>
			<Label
				text="right box"
				x={2.5}
				y={0.8}
				color={palette().muted}
				fontSize={0.35}
			/>
			<Circle
				center={token}
				radius={0.3}
				fill={palette().series[0]}
				label="token"
				{...drag}
			/>
			<Label
				text={`dropped on: ${chosen()}`}
				y={2.3}
				color={palette().muted}
				fontSize={0.4}
			/>
			<Label
				text="drag the token onto a box"
				y={-2.5}
				color={palette().muted}
				fontSize={0.28}
			/>
		</Stage>
	);
}
