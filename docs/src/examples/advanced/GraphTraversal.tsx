import { derive, hold, sequence, track, valueTo } from "@sophistry/core";
import { edgeKey } from "@sophistry/core/geometry";
import {
	NetworkGraph,
	Stage,
	Text,
	usePlayer,
	useScene,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Breadth-first traversal",
	description:
		"A BFS over a small graph. The visit order is computed once; a single step counter drives which vertices and edges are lit.",
};

const vertices = ["a", "b", "c", "d", "e", "f", "g"];
const edges: [string, string][] = [
	["a", "b"],
	["a", "c"],
	["b", "d"],
	["b", "e"],
	["c", "f"],
	["c", "g"],
	["e", "f"],
];

/** Visit order plus the edge each vertex was discovered through. */
function bfs(start: string) {
	const order = [start];
	const via = new Map<string, [string, string]>();
	for (let head = 0; head < order.length; head++) {
		const u = order[head];
		for (const [s, t] of edges) {
			const v = s === u ? t : t === u ? s : undefined;
			if (v && !order.includes(v)) {
				order.push(v);
				via.set(v, [u, v]);
			}
		}
	}
	return { order, via };
}

function Traversal() {
	const theme = useScene().theme;
	const { play, signal } = usePlayer();
	const { order, via } = bfs("a");
	// How many vertices have been visited so far; the only moving part.
	const step = track(0);
	const visited = derive(step, (step) => order.slice(0, Math.round(step)));

	const vertexConfigs = derive([visited, theme], (visited, theme) =>
		Object.fromEntries(
			visited.map((v) => [v, { color: theme.palette.highlight }]),
		),
	);
	const edgeConfigs = derive([visited, theme], (visited, theme) =>
		Object.fromEntries(
			visited.flatMap((v) => {
				const edge = via.get(v);
				return edge
					? [
							[
								edgeKey(...edge),
								{ stroke: theme.palette.highlight, strokeWidth: 0.07 },
							],
						]
					: [];
			}),
		),
	);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						hold(0.6),
						valueTo(step, order.length, { duration: 4, easing: "linear" }),
						hold(1.2),
						valueTo(step, 0, { duration: 0.6 }),
					),
				);
			}
		})();
	});

	return (
		<>
			<NetworkGraph
				vertices={vertices}
				edges={edges}
				layout="tree"
				layoutOptions={{ root: "a" }}
				layoutScale={{ width: 8, height: 4 }}
				labels
				vertexConfigs={vertexConfigs}
				edgeConfigs={edgeConfigs}
			/>
			<Text
				text={derive(
					visited,
					(visited) => `visited: ${visited.join(" ") || "-"}`,
				)}
				y={-3.4}
				fontSize={0.4}
			/>
		</>
	);
}

export default function GraphTraversal() {
	return (
		<Stage units={12} aspect={1.5}>
			<Traversal />
		</Stage>
	);
}
