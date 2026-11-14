import { BLUE, circle, YELLOW } from "@sophistry/core";
import { Stage, Text } from "@sophistry/solidjs";
import { Box } from "@sophistry/solidjs/box";
import { mathTex } from "@sophistry/text";

export const meta = {
	title: "Formulas inside sentences",
	description:
		"Any scene node can sit in a line of text like a wide glyph: a typeset formula mid-sentence and a coloured dot as a legend key, wrapping with the words around them.",
};

const INK = "#e6edf5";

export default function InlineFormula() {
	return (
		<Stage>
			<Box
				style={{
					width: 1100,
					padding: 56,
					gap: 32,
					flexDirection: "column",
					background: "#16202e",
					borderRadius: 32,
					color: INK,
					fontSize: 44,
				}}
			>
				<Text
					text={[
						"The roots of ",
						{
							inline: mathTex.create({
								tex: "ax^2 + bx + c",
								fontSize: 0.42,
								fill: INK,
							}),
						},
						" are ",
						{
							inline: mathTex.create({
								tex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
								fontSize: 0.42,
								fill: INK,
							}),
						},
						", real exactly when the discriminant is not negative.",
					]}
				/>
				<Text
					fontSize={34}
					text={[
						{
							inline: circle.create({
								radius: 0.1,
								fill: BLUE,
								stroke: "none",
							}),
						},
						" measured   ",
						{
							inline: circle.create({
								radius: 0.1,
								fill: YELLOW,
								stroke: "none",
							}),
						},
						" predicted",
					]}
				/>
			</Box>
		</Stage>
	);
}
