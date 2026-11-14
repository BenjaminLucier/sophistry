import type { PaletteSpec } from "@sophistry/core";
import { definePalette, derive, resolvePalette } from "@sophistry/core";
import { Circle, Text, Rect, Stage, useScene } from "@sophistry/solidjs";
import { createSignal, For } from "solid-js";

export const meta = {
	title: "Palette switcher",
	description:
		"Tap a swatch to hand the whole scene a different palette. Shapes, labels and the ground all restyle because they only read theme tokens.",
};

const ocean = definePalette({
	name: "ocean",
	dark: {
		background: "#07182b",
		foreground: "#e3f2ff",
		accent: "#38bdf8",
		series: ["#38bdf8", "#34d399", "#fbbf24", "#f472b6"],
	},
	light: {
		background: "#f3f9ff",
		foreground: "#0b2a47",
		accent: "#0369a1",
		series: ["#0369a1", "#047857", "#b45309", "#be185d"],
	},
});
const ember = definePalette({
	name: "ember",
	dark: {
		background: "#1c0d08",
		foreground: "#fde7d9",
		accent: "#fb923c",
		series: ["#fb923c", "#f87171", "#facc15", "#a78bfa"],
	},
	light: {
		background: "#fff7f1",
		foreground: "#3b1405",
		accent: "#c2410c",
		series: ["#c2410c", "#b91c1c", "#a16207", "#6d28d9"],
	},
});

const CHOICES: { name: string; palette: PaletteSpec }[] = [
	{ name: "catppuccin", palette: "catppuccin" },
	{ name: "ocean", palette: ocean },
	{ name: "ember", palette: ember },
];

function Scene(props: { selected: () => number; select: (i: number) => void }) {
	const series = derive(useScene().theme, (theme) => theme.palette.series);
	return (
		<>
			<For each={[0, 1, 2, 3]}>
				{(i) => {
					const color = derive(series, (s) => s[i % s.length]);
					return (
						<Rect
							center={{ x: (i - 1.5) * 1.7, y: 0.9 }}
							width={1.3}
							height={(i + 1) * 0.45}
							stroke={color}
							fill={color}
							fillOpacity={0.4}
						/>
					);
				}}
			</For>
			<For each={CHOICES}>
				{(choice, i) => (
					<>
						<Circle
							center={{ x: (i() - 1) * 2.6, y: -1.6 }}
							radius={0.45}
							fill={resolvePalette(choice.palette).dark.accent}
							strokeWidth={props.selected() === i() ? 0.1 : 0.03}
							label={`${choice.name} palette`}
							cursor="pointer"
							onTap={() => props.select(i())}
						/>
						<Text
							text={choice.name}
							x={(i() - 1) * 2.6}
							y={-2.5}
							fontSize={0.28}
						/>
					</>
				)}
			</For>
		</>
	);
}

export default function PaletteSwitcher() {
	// User input, so a Solid signal: the stage re-themes when it changes.
	const [selected, setSelected] = createSignal(0);
	return (
		<Stage units={10} palette={CHOICES[selected()].palette}>
			<Scene selected={selected} select={setSelected} />
		</Stage>
	);
}
