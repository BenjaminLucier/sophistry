import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Heatmap } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Clustered heatmap",
	description:
		"Hours of use per app and weekday, clustered both ways by average linkage: similar apps and similar days move next to each other, and each dendrogram replays its merges, closest first, as the cells fade in.",
	uses: ["Stage", "Heatmap", "track", "draw", "usePlayer"],
};

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Three kinds of app — work, social, games — listed out of order.
const apps = [
	{ app: "Mail", kind: 0 },
	{ app: "Chat", kind: 1 },
	{ app: "Chess", kind: 2 },
	{ app: "Docs", kind: 0 },
	{ app: "Photos", kind: 1 },
	{ app: "Puzzles", kind: 2 },
	{ app: "Calendar", kind: 0 },
	{ app: "Forum", kind: 1 },
];
const weekday = [3, 1.2, 0.6];
const weekend = [0.5, 2.5, 2.8];
const usage = apps.flatMap(({ app, kind }, i) =>
	days.map((day, j) => {
		const base = j >= 5 ? weekend[kind] : weekday[kind];
		const wobble = 0.4 * Math.sin((i + 1) * (j + 2) * 2.3);
		return { app, day, hours: Math.max(0, base + wobble) };
	}),
);

export default function ClusteredHeatmap() {
	const { play } = usePlayer();
	const progress = track(0);
	onSettled(() => {
		void play(draw(progress, { duration: 3 }));
	});

	return (
		<Stage units={12}>
			<Heatmap
				data={usage}
				x="day"
				y="app"
				value="hours"
				cluster
				labels={false}
				ramp="viridis"
				colorbar
				colorbarLabel="hours"
				width={6.4}
				height={3.8}
				center={{ x: 0.4, y: -0.3 }}
				dendrogramSize={0.9}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
