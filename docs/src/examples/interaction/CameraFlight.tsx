import {
	hold,
	moveTo,
	parallel,
	sequence,
	track,
	trackPoint,
	valueTo,
} from "@sophistry/core";
import {
	Dot,
	Label,
	NumberPlane,
	Stage,
	usePlayer,
	useTheme,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Animating the camera",
	description:
		"A stage's units and center are ordinary tracks, so moveTo and valueTo fly the camera between landmarks. Nothing is rebuilt: the same scene repaints through a new view.",
	uses: [
		"Stage",
		"NumberPlane",
		"Dot",
		"Label",
		"track",
		"trackPoint",
		"moveTo",
		"valueTo",
		"parallel",
		"sequence",
		"hold",
		"usePlayer",
		"useTheme",
	],
};

const LANDMARKS = [
	{ name: "A", at: { x: -6, y: 3 } },
	{ name: "B", at: { x: 5, y: -2 } },
	{ name: "C", at: { x: 1, y: 4 } },
];

export default function CameraFlight() {
	const { play, signal } = usePlayer();
	const theme = useTheme();
	const palette = () => theme().palette;
	const units = track(24);
	const center = trackPoint(0, 0);

	// Zoom in on a landmark, hold, then pull back out to the whole plane.
	const visit = (at: { x: number; y: number }) =>
		sequence(
			parallel(
				moveTo(center, at, { duration: 1.2 }),
				valueTo(units, 6, { duration: 1.2 }),
			),
			hold(0.8),
			parallel(
				moveTo(center, { x: 0, y: 0 }, { duration: 1.2 }),
				valueTo(units, 24, { duration: 1.2 }),
			),
			hold(0.4),
		);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				for (const landmark of LANDMARKS) await play(visit(landmark.at));
			}
		})();
	});

	return (
		<Stage units={units} center={center}>
			<NumberPlane xRange={[-12, 12]} yRange={[-8, 8]} width={24} height={16} />
			{LANDMARKS.map((landmark, i) => (
				<>
					<Dot center={landmark.at} radius={0.3} color={palette().series[i]} />
					<Label
						text={landmark.name}
						x={landmark.at.x}
						y={landmark.at.y + 0.9}
						color={palette().muted}
					/>
				</>
			))}
		</Stage>
	);
}
