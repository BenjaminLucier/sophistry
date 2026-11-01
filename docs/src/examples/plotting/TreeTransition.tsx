import { draw, hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Tree } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Tree data transition",
	description:
		"A reorganisation as a node-link tree. Nodes are matched by their path of names: the team that was wound up draws back into its parent, the rest slide to their new places with their links following, then the new teams grow out of theirs. One blend track drives it, so it scrubs.",
};

type Unit = { name: string; children?: Unit[] };
const teams = (...names: string[]) => names.map((name) => ({ name }));

const before: Unit = {
	name: "CTO",
	children: [
		{ name: "Platform", children: teams("Infra", "Data", "Security") },
		{ name: "Product", children: teams("Web", "Mobile") },
		{ name: "Labs", children: teams("Research") },
	],
};
const after: Unit = {
	name: "CTO",
	children: [
		{ name: "Platform", children: teams("Infra", "Data") },
		{ name: "Product", children: teams("Web", "Mobile", "Growth") },
		{ name: "Trust", children: teams("Security", "Privacy") },
	],
};

export default function TreeTransition() {
	const { play, signal } = usePlayer();
	const progress = track(0);
	const blend = track(0);

	onSettled(() => {
		void (async () => {
			await play(draw(progress, { duration: 1.5 }));
			while (!signal.aborted) {
				await play(
					sequence(
						hold(1),
						// Staged transitions ease each stage themselves: drive them linearly.
						valueTo(blend, 1, { duration: 1.8, easing: "linear" }),
						hold(1.2),
						valueTo(blend, 0, { duration: 1.8, easing: "linear" }),
					),
				);
			}
		})();
	});

	return (
		<Stage units={10}>
			<Tree
				data={before}
				to={after}
				blend={blend}
				label="name"
				width={8}
				height={4.2}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
