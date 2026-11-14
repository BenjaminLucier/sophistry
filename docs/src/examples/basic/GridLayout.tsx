import { BLUE, GREEN, RED, YELLOW } from "@sophistry/core";
import { Circle, Square, Stage, Star, Text } from "@sophistry/solidjs";
import { Box } from "@sophistry/solidjs/box";

export const meta = {
	title: "Grid layout",
	description:
		"A box with display: grid: a title spanning every column, three equal columns of cards, and a footer row, with tracks in design pixels and fr.",
};

const card = {
	padding: 28,
	gap: 16,
	flexDirection: "column",
	alignItems: "center",
	background: "#22304a",
	borderRadius: 24,
} as const;

export default function GridLayout() {
	return (
		<Stage>
			<Box
				style={{
					display: "grid",
					width: 1300,
					gridTemplateColumns: [{ repeat: 3, tracks: [{ fr: 1 }] }],
					gap: 28,
					padding: 48,
					background: "#16202e",
					borderRadius: 36,
					color: "#e6edf5",
					fontSize: 36,
				}}
			>
				<Box style={{ gridColumn: { span: 3 } }}>
					<Text text="Three shapes" fontSize={64} fontWeight={700} />
				</Box>
				<Box style={card}>
					<Circle radius={0.7} stroke={BLUE} strokeWidth={0.05} />
					<Text text="circle" />
				</Box>
				<Box style={card}>
					<Square size={1.3} stroke={GREEN} strokeWidth={0.05} />
					<Text text="square" />
				</Box>
				<Box style={card}>
					<Star outerRadius={0.8} stroke={RED} strokeWidth={0.05} />
					<Text text="star" />
				</Box>
				<Box
					style={{
						gridColumn: { start: 2, span: 2 },
						justifyContent: "flex-end",
						color: YELLOW,
						fontSize: 28,
					}}
				>
					<Text text="the footer spans the last two columns" />
				</Box>
			</Box>
		</Stage>
	);
}
