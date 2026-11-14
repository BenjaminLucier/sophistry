import { draw, track } from "@sophistry/core";
import { NetworkGraph, Stage, Text, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Network layouts",
	description:
		"One set of vertices and edges placed three ways by changing only the layout prop.",
};

const vertices = [1, 2, 3, 4, 5, 6];
const edges: [number, number][] = [
	[1, 2],
	[1, 3],
	[2, 4],
	[2, 5],
	[3, 6],
];

export default function NetworkLayouts() {
	const { play } = usePlayer();
	const drawn = track(0);

	onSettled(() => {
		void play(draw(drawn, { duration: 2 }));
	});

	return (
		<Stage units={14}>
			<NetworkGraph
				vertices={vertices}
				edges={edges}
				layout="circular"
				center={{ x: -4.6, y: 0 }}
				progress={drawn}
			/>
			<NetworkGraph
				vertices={vertices}
				edges={edges}
				layout="tree"
				layoutOptions={{ root: 1 }}
				layoutScale={{ width: 3.5, height: 3.5 }}
				center={{ x: 0, y: 0 }}
				progress={drawn}
			/>
			<NetworkGraph
				vertices={vertices}
				edges={edges}
				layout="grid"
				layoutScale={{ width: 3.5, height: 2 }}
				center={{ x: 4.6, y: 0 }}
				progress={drawn}
			/>
			<Text text="circular" x={-4.6} y={-3.2} />
			<Text text="tree" x={0} y={-3.2} />
			<Text text="grid" x={4.6} y={-3.2} />
		</Stage>
	);
}
