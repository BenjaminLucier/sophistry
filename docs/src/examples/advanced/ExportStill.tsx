import type { Scene } from "@sophistry/core";
import { captureFrame, derive, rotateBy, track } from "@sophistry/core";
import { Circle, Stage, Text, usePlayer, useScene } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Export a PNG",
	description:
		"The stage's ref hands you the scene. captureFrame encodes scene.canvas as last painted; download the blob.",
};

function Orbit() {
	const palette = derive(useScene().theme, (theme) => theme.palette);
	const { play } = usePlayer();
	const angle = track(0);

	onSettled(() => {
		void play(rotateBy(angle, 2 * Math.PI, { duration: 8, easing: "linear" }));
	});

	return (
		<>
			<Circle
				center={{ x: 0, y: 0 }}
				radius={2.5}
				stroke={derive(palette, (palette) => palette.grid)}
			/>
			<Circle
				center={derive(angle, (angle) => ({
					x: 2.5 * Math.cos(angle),
					y: 2.5 * Math.sin(angle),
				}))}
				radius={0.4}
				fill={derive(palette, (palette) => palette.series[0])}
			/>
			<Text
				text="a moving frame, saved on click"
				y={-3.4}
				color={derive(palette, (palette) => palette.muted)}
			/>
		</>
	);
}

export default function ExportStill() {
	let scene: Scene | undefined;

	const exportPng = async () => {
		const canvas = scene?.canvas;
		if (!canvas) return;
		const blob = await captureFrame(canvas, { type: "image/png" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = "sophistry-still.png";
		link.click();
		URL.revokeObjectURL(url);
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
				<Orbit />
			</Stage>
			<button
				type="button"
				onClick={() => void exportPng()}
				style={{ "margin-top": "0.5rem" }}
			>
				Export PNG
			</button>
		</div>
	);
}
