import { BLUE, lagged, track, valueTo, YELLOW } from "@sophistry/core";
import { Circle, Stage, Text, usePlayer } from "@sophistry/solidjs";
import { Box } from "@sophistry/solidjs/box";
import { onSettled } from "solid-js";

export const meta = {
	title: "Boxes and layout",
	description:
		"A card laid out with flexbox in design pixels: a heading, wrapped rich text, a row of tags and a circle in scene units, written on in order.",
};

export default function BoxLayout() {
	const { play } = usePlayer();
	const heading = track(0);
	const body = track(0);
	const shape = track(0);

	onSettled(() => {
		void play(
			lagged(
				[heading, body, shape].map((t) =>
					valueTo(t, 1, { duration: 1.2, easing: "linear" }),
				),
				{ lagRatio: 0.7 },
			),
		);
	});

	const tag = (label: string) => (
		<Box
			style={{
				paddingTop: 8,
				paddingBottom: 8,
				paddingLeft: 20,
				paddingRight: 20,
				borderRadius: 999,
				background: "#2b3a52",
				fontSize: 28,
			}}
		>
			<Text text={label} progress={body} />
		</Box>
	);

	return (
		<Stage>
			<Box
				style={{
					width: 1400,
					flexDirection: "row",
					gap: 56,
					padding: 64,
					background: "#16202e",
					borderWidth: 3,
					borderColor: "#3d5170",
					borderRadius: 40,
					color: "#e6edf5",
					fontSize: 36,
					alignItems: "center",
				}}
			>
				<Box style={{ flex: 1, flexDirection: "column", gap: 28 }}>
					<Text
						text="Fourier series"
						fontSize={84}
						fontWeight={700}
						progress={heading}
					/>
					<Text
						text={[
							"Any reasonable ",
							{ text: "periodic", italic: true, color: YELLOW },
							" function is a sum of sines and cosines, each a whole multiple of one ",
							{ text: "fundamental frequency", fontWeight: 700, color: BLUE },
							".",
						]}
						progress={body}
					/>
					<Box style={{ flexDirection: "row", gap: 16 }}>
						{tag("analysis")}
						{tag("signals")}
						{tag("heat equation")}
					</Box>
				</Box>
				<Circle
					radius={1.6}
					stroke={BLUE}
					strokeWidth={0.06}
					progress={shape}
				/>
			</Box>
		</Stage>
	);
}
