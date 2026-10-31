import { draggable, toBounds, trackPoint } from "@sophistry/core";
import {
	Dot,
	Label,
	MultiStage,
	NumberPlane,
	PictureInPicture,
	useTheme,
} from "@sophistry/solidjs";

export const meta = {
	title: "Picture-in-picture",
	description:
		"One scene seen through two cameras. Drag the dot in the main view and the magnified inset follows it.",
	uses: [
		"MultiStage",
		"PictureInPicture",
		"NumberPlane",
		"Dot",
		"Label",
		"draggable",
		"toBounds",
		"trackPoint",
		"useTheme",
	],
};

export default function PictureInPictureViews() {
	const theme = useTheme();
	const palette = () => theme().palette;
	const dot = trackPoint(-1, 0.5);
	const box = { minX: -5, maxX: 5, minY: -2.5, maxY: 2.5 };
	const handle = draggable(dot, { constrain: toBounds(box, { half: 0.2 }) });

	return (
		<MultiStage units={10}>
			<NumberPlane xRange={[-6, 6]} yRange={[-4, 4]} width={12} height={8} />
			<Dot center={dot} radius={0.2} label="dot" {...handle} />
			<Label
				text="drag the dot"
				x={3}
				y={-2.4}
				color={palette().muted}
				fontSize={0.28}
			/>
			<PictureInPicture
				main={{}}
				inset={{ units: 3, center: dot, border: palette().accent }}
				corner="top-left"
			/>
		</MultiStage>
	);
}
