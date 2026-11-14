import { BLUE, lagged, track, valueTo } from "@sophistry/core";
import {
	BulletedList,
	Stage,
	Text,
	Title,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Text blocks, lists and titles",
	description:
		"A title with its rule, rich text wrapped to a measure and a bulleted list, each written in reading order or an item at a time.",
};

export default function TextBlocks() {
	const { play } = usePlayer();
	const title = track(0);
	const paragraph = track(0);
	const list = track(0);

	onSettled(() => {
		void play(
			lagged(
				[title, paragraph, list].map((t) =>
					valueTo(t, 1, { duration: 1.5, easing: "linear" }),
				),
				{ lagRatio: 0.8 },
			),
		);
	});

	return (
		<Stage units={14}>
			<Title text="Continuity" progress={title} />
			<Text
				x={-3}
				y={0.6}
				width={6}
				fontSize={0.36}
				textAlign="left"
				text={[
					"A function is ",
					{ text: "continuous", fontWeight: 700, color: BLUE },
					" at a point when small changes in its input give small changes in its output. Nothing ",
					{ text: "jumps", italic: true },
					", and nothing is ",
					{ text: "missing", underline: true },
					".",
				]}
				progress={paragraph}
			/>
			<BulletedList
				x={3.8}
				y={0.6}
				fontSize={0.36}
				items={["No jumps", "No holes", "No vertical asymptotes"]}
				progress={list}
			/>
		</Stage>
	);
}
