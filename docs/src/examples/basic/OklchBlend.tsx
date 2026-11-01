import { derive, mixColor, toCss } from "@sophistry/core";
import { Label, Rect, Stage, useScene } from "@sophistry/solidjs";
import { For } from "solid-js";

export const meta = {
	title: "RGB versus OKLCH blends",
	description:
		"The same blue-to-yellow blend in two color spaces. RGB sags through a muddy gray in the middle; OKLCH keeps its lightness and sweeps the hue.",
};

const FROM = "#2563eb";
const TO = "#facc15";
const STEPS = 15;

function Strip(props: {
	y: number;
	colorSpace: "rgb" | "oklch";
	name: string;
}) {
	const muted = derive(useScene().theme, (theme) => theme.palette.muted);
	return (
		<>
			<For each={Array.from({ length: STEPS }, (_, i) => i)}>
				{(i) => (
					<Rect
						center={{ x: (i - (STEPS - 1) / 2) * 0.62, y: props.y }}
						width={0.62}
						height={1.1}
						strokeWidth={0}
						fill={toCss(
							mixColor(FROM, TO, i / (STEPS - 1), {
								colorSpace: props.colorSpace,
							}),
						)}
					/>
				)}
			</For>
			<Label
				text={props.name}
				y={props.y - 0.95}
				fontSize={0.3}
				color={muted}
			/>
		</>
	);
}

export default function OklchBlend() {
	return (
		<Stage units={11}>
			<Strip
				y={1.1}
				colorSpace="rgb"
				name={'mixColor(a, b, t, { colorSpace: "rgb" })'}
			/>
			<Strip
				y={-1.5}
				colorSpace="oklch"
				name={'mixColor(a, b, t, { colorSpace: "oklch" })'}
			/>
		</Stage>
	);
}
