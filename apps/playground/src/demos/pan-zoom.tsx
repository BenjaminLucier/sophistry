import { track, trackPoint } from "@sophistry/core";
import {
	Circle,
	Dot,
	NumberPlane,
	PanZoom,
	Stage,
	Text,
} from "@sophistry/solidjs";

/**
 * `<PanZoom>` sits inside the stage and writes
 * the same `units`/`center` tracks the stage binds: wheel to zoom (pinned to
 * the cursor), drag to pan, pinch on a trackpad. Nothing here owns the
 * framing, so an animation could drive the same tracks between gestures.
 */
export function PanZoomDemo() {
	const units = track(14);
	const center = trackPoint(0, 0);

	return (
		<Stage units={units} center={center}>
			<PanZoom units={units} center={center} minUnits={4} maxUnits={40} />
			<NumberPlane xRange={[-8, 8]} yRange={[-5, 5]} width={14} height={8.75} />
			<Circle
				center={{ x: 3, y: 2 }}
				radius={1.2}
				fill="#416bbe"
				fillOpacity={0.5}
			/>
			<Dot center={{ x: -3, y: -2 }} color="#00ffb7" />
			<Text text="scroll to zoom, drag to pan" y={-3.5} />
		</Stage>
	);
}
