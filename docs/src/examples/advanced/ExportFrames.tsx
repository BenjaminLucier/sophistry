import type { Readable, Scene } from "@sophistry/core";
import { derive, exportFrames, rotateTo, track } from "@sophistry/core";
import { Circle, Text, Stage, usePlayer, useScene } from "@sophistry/solidjs";
import { createSignal, For, onCleanup } from "solid-js";

export const meta = {
	title: "Export an image sequence",
	description:
		"exportFrames seeks a timeline to exact instants, paints each one synchronously and encodes the canvas. The thumbnails are real exported frames.",
};

interface Thumb {
	url: string;
	time: number;
}

/** A dot on a ring at `angle`, in the scene's theme colours. */
function Orbit(props: { angle: Readable<number> }) {
	const palette = derive(useScene().theme, (theme) => theme.palette);

	return (
		<>
			<Circle
				center={{ x: 0, y: 0 }}
				radius={2.5}
				stroke={derive(palette, (palette) => palette.grid)}
			/>
			<Circle
				center={derive(props.angle, (angle) => ({
					x: 2.5 * Math.cos(angle),
					y: 2.5 * Math.sin(angle),
				}))}
				radius={0.4}
				fill={derive(palette, (palette) => palette.series[0])}
			/>
			<Text
				text="rendered frame by frame"
				y={-3.4}
				color={derive(palette, (palette) => palette.muted)}
			/>
		</>
	);
}

export default function ExportFrames() {
	const { timeline } = usePlayer();
	const angle = track(0);
	const spin = timeline(
		rotateTo(angle, 2 * Math.PI, { duration: 2, easing: "linear" }),
	);
	let scene: Scene | undefined;
	const [thumbs, setThumbs] = createSignal<Thumb[]>([]);
	const [busy, setBusy] = createSignal(false);

	const release = () => {
		for (const thumb of thumbs()) URL.revokeObjectURL(thumb.url);
	};
	onCleanup(release);

	const run = async () => {
		const canvas = scene?.canvas;
		if (!canvas || busy()) return;
		setBusy(true);
		release();
		setThumbs([]);
		try {
			// 2 s at 6 fps, the last frame excluded so the sequence would loop.
			const frames = await exportFrames({
				timeline: spin,
				canvas,
				fps: 6,
				to: 2 - 1 / 6,
				type: "image/webp",
				quality: 0.8,
			});
			setThumbs(
				frames.map((frame) => ({
					url: URL.createObjectURL(frame.blob),
					time: frame.time,
				})),
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div>
			<Stage
				units={10}
				aspect={4 / 3}
				ref={(created) => {
					scene = created;
				}}
			>
				<Orbit angle={angle} />
			</Stage>
			<button
				type="button"
				onClick={() => void run()}
				disabled={busy()}
				style={{ "margin-top": "0.5rem" }}
			>
				{busy() ? "Exporting..." : "Export 12 frames"}
			</button>
			<div
				style={{
					display: "flex",
					"flex-wrap": "wrap",
					gap: "0.25rem",
					"margin-top": "0.5rem",
				}}
			>
				<For each={thumbs()}>
					{(thumb) => (
						<img
							src={thumb.url}
							alt={`Frame at ${thumb.time.toFixed(2)} seconds`}
							title={`t = ${thumb.time.toFixed(2)} s`}
							style={{ width: "96px", "border-radius": "4px" }}
						/>
					)}
				</For>
			</div>
		</div>
	);
}
