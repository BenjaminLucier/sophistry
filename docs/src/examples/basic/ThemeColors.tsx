import { derive } from "@sophistry/core";
import { Circle, Stage, Text, useScene } from "@sophistry/solidjs";
import { For } from "solid-js";

export const meta = {
	title: "Theme colors",
	description:
		"Every default color comes from the active theme; these swatches read its palette tokens and follow the site's light and dark mode.",
};

const TOKENS = [
	"accent",
	"highlight",
	"positive",
	"negative",
	"warning",
	"info",
] as const;

function Swatches() {
	const theme = useScene().theme;

	return (
		<For each={TOKENS}>
			{(token, i) => {
				const color = derive(theme, (t) => t.palette[token]);
				return (
					<>
						<Circle
							center={{ x: (i() - 2.5) * 1.9, y: 0 }}
							radius={0.7}
							stroke={color}
							fill={color}
							fillOpacity={0.4}
						/>
						<Text text={token} x={(i() - 2.5) * 1.9} y={-1.4} fontSize={0.3} />
					</>
				);
			}}
		</For>
	);
}

export default function ThemeColors() {
	return (
		<Stage units={12}>
			<Swatches />
		</Stage>
	);
}
