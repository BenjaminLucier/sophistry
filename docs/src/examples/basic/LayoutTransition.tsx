import { type BoxNode, layoutTo } from "@sophistry/box";
import { hold, sequence } from "@sophistry/core";
import { Stage, Text, usePlayer } from "@sophistry/solidjs";
import { Box } from "@sophistry/solidjs/box";
import { onSettled } from "solid-js";

export const meta = {
	title: "Layout transitions",
	description:
		"layoutTo changes boxes' styles and children and moves everything to its new place: tiles reorder, then the row turns into a column, each tile gliding there.",
};

const tiles = [
	{ label: "sin", color: "#58c4dd" },
	{ label: "cos", color: "#83c167" },
	{ label: "tan", color: "#fc6255" },
	{ label: "exp", color: "#f0ac5f" },
];

const row = {
	flexDirection: "row",
	gap: 32,
	padding: 40,
	background: "#16202e",
	borderRadius: 32,
	color: "#0b1018",
	fontSize: 56,
	fontWeight: 700,
} as const;

const column = { ...row, flexDirection: "column", gap: 20 } as const;

export default function LayoutTransition() {
	const { play, signal } = usePlayer();
	let container: BoxNode | undefined;
	const nodes: BoxNode[] = [];

	onSettled(() => {
		void (async () => {
			while (!signal.aborted && container) {
				const [a, b, c, d] = nodes as [BoxNode, BoxNode, BoxNode, BoxNode];
				await play(
					sequence(
						hold(0.6),
						layoutTo(container, { children: [d, b, a, c] }, { duration: 1 }),
						hold(0.6),
						layoutTo(container, { style: column }, { duration: 1 }),
						hold(0.6),
						layoutTo(
							container,
							{ style: row, children: [a, b, c, d] },
							{ duration: 1 },
						),
					),
				);
			}
		})();
	});

	return (
		<Stage>
			<Box style={row} ref={(node) => (container = node)}>
				{tiles.map((tile, index) => (
					<Box
						ref={(node) => (nodes[index] = node)}
						style={{
							width: 200,
							paddingTop: 24,
							paddingBottom: 24,
							borderRadius: 20,
							background: tile.color,
							justifyContent: "center",
						}}
					>
						<Text text={tile.label} />
					</Box>
				))}
			</Box>
		</Stage>
	);
}
