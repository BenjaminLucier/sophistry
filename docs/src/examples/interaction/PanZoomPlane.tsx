import { track, trackPoint } from "@sophistry/core";
import {
	Circle,
	Dot,
	Text,
	NumberPlane,
	PanZoom,
	Stage,
	useTheme,
} from "@sophistry/solidjs";

export const meta = {
	title: "Pan and zoom",
	description:
		"Scroll to zoom about the cursor and drag empty space to pan. PanZoom writes the same units and center tracks that the Stage reads.",
};

export default function PanZoomPlane() {
	const theme = useTheme();
	const palette = () => theme().palette;
	const units = track(14);
	const center = trackPoint(0, 0);

	return (
		<Stage units={units} center={center}>
			<PanZoom units={units} center={center} minUnits={4} maxUnits={40} />
			<NumberPlane xRange={[-8, 8]} yRange={[-5, 5]} width={14} height={8.75} />
			<Circle
				center={{ x: 3, y: 1 }}
				radius={1.2}
				fill={palette().series[0]}
				fillOpacity={0.4}
			/>
			<Dot center={{ x: -3, y: -1.5 }} color={palette().series[1]} />
			<Text
				text="scroll to zoom, drag to pan"
				x={-3.5}
				y={3}
				color={palette().muted}
			/>
		</Stage>
	);
}
