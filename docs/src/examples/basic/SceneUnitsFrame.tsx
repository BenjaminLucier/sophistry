import type { ColorInput, ThemePalette } from "@sophistry/core";
import { derive } from "@sophistry/core";
import { Dot, Label, Line, Stage, useScene } from "@sophistry/solidjs";
import { For } from "solid-js";

export const meta = {
	title: "Scene units and the frame",
	description:
		"A unit grid with y pointing up, the origin at the center, and the visible frame read back from useScene().frame: units={8} at 16:9 spans x from -4 to 4 and y from -2.25 to 2.25.",
	uses: ["Stage", "Line", "Dot", "Label", "useScene", "derive"],
};

const XS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
const YS = [-2, -1, 0, 1, 2];

function Grid() {
	const scene = useScene();
	// A colour that follows the theme (and the site's light and dark mode).
	const palette = (pick: (palette: ThemePalette) => ColorInput) =>
		derive(scene.theme, (theme) => pick(theme.palette));
	const frame = scene.frame;

	return (
		<>
			<For each={XS}>
				{(x) => (
					<Line
						from={derive(frame, (f) => ({ x, y: f.minY }))}
						to={derive(frame, (f) => ({ x, y: f.maxY }))}
						stroke={palette((p) => (x === 0 ? p.muted : p.grid))}
						strokeWidth={x === 0 ? 0.03 : 0.015}
					/>
				)}
			</For>
			<For each={YS}>
				{(y) => (
					<Line
						from={derive(frame, (f) => ({ x: f.minX, y }))}
						to={derive(frame, (f) => ({ x: f.maxX, y }))}
						stroke={palette((p) => (y === 0 ? p.muted : p.grid))}
						strokeWidth={y === 0 ? 0.03 : 0.015}
					/>
				)}
			</For>
			<Dot
				center={{ x: 1, y: 1.5 }}
				color={palette((p) => p.series[0])}
				radius={0.08}
			/>
			<Label
				text="(1, 1.5)"
				x={1.15}
				y={1.5}
				align="left"
				fontSize={0.2}
				color={palette((p) => p.series[0])}
			/>
			<Label
				text="origin"
				x={0.12}
				y={-0.15}
				align="left"
				fontSize={0.2}
				color={palette((p) => p.muted)}
			/>
			<Label
				text={derive(
					frame,
					(f) => `frame: x ${f.minX} to ${f.maxX}, y ${f.minY} to ${f.maxY}`,
				)}
				y={derive(frame, (f) => f.minY + 0.3)}
				fontSize={0.2}
				color={palette((p) => p.muted)}
				// Lifted off the grid and axis lines that run under it.
				halo
			/>
		</>
	);
}

export default function SceneUnitsFrame() {
	return (
		<Stage units={8}>
			<Grid />
		</Stage>
	);
}
