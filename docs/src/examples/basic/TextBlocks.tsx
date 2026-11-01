import { lagged, track, valueTo } from "@sophistry/core";
import {
	BulletedList,
	Paragraph,
	Stage,
	Title,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Paragraphs, lists and titles",
	description:
		"A title with its rule, a paragraph wrapped to a measure and a bulleted list, each written in a line or an item at a time.",
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
			<Paragraph
				x={-3}
				y={0.6}
				width={6}
				fontSize={0.36}
				text="A function is continuous at a point when small changes in its input give small changes in its output. Nothing jumps, and nothing is missing."
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
