import { draggable, onCircle, snapToGrid, trackPoint } from "@sophistry/core";
import {
	Circle,
	InteractionGroup,
	LabeledDot,
	Stage,
	Text,
} from "@sophistry/solidjs";

/**
 * Three dots, three constraint systems. The dots'
 * centres are the tracks themselves (bound in core, so a drag runs no Solid
 * code); the constraint receives the proposed point and returns the allowed
 * one: free, pinned to a circle, or snapped to a grid.
 */
export function DragDemo() {
	const freePos = trackPoint(2.6, 1.6);
	const ringPos = trackPoint(0, 2);
	const gridPos = trackPoint(-2.5, -1);

	const free = draggable(freePos);
	const ring = draggable(ringPos, { constrain: onCircle({ x: 0, y: 0 }, 2) });
	const grid = draggable(gridPos, { constrain: snapToGrid(0.5) });

	return (
		<Stage units={12}>
			<Circle
				center={{ x: 0, y: 0 }}
				radius={2}
				stroke="#8da6d8"
				dash={[0.15, 0.15]}
				strokeWidth={0.04}
			/>
			<InteractionGroup drag={free.drag} keyboard={free.keyboard} cursor="grab">
				<LabeledDot center={freePos} text="free" />
			</InteractionGroup>
			<InteractionGroup drag={ring.drag} keyboard={ring.keyboard} cursor="grab">
				<LabeledDot center={ringPos} text="ring" color="#00ffb7" />
			</InteractionGroup>
			<InteractionGroup drag={grid.drag} keyboard={grid.keyboard} cursor="grab">
				<LabeledDot center={gridPos} text="grid" color="#ff6b6b" />
			</InteractionGroup>
			<Text text="drag a dot, or nudge it with the arrow keys" y={-2.9} />
		</Stage>
	);
}
