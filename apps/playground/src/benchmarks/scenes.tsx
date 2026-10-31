import type { Component } from "solid-js";
import type { BenchSceneProps, ParamDef } from "./harness";
import {
	NextAllMoving,
	NextCameraPan,
	NextChurn,
	NextNumberPlanePan,
	NextOneMoving,
	NextReorder,
	NextScatterPan,
	NextScatterTransition,
} from "./scenes-impl";

/**
 * Each benchmark is a *style* of load, chosen to stress one thing: `all-moving`
 * (every node changes every frame), `one-moving` (cost should track what
 * changed, not scene size), `camera-pan`, `churn` (mounting and unmounting
 * while running), `reorder`, and the scatter chart pan and transition.
 */

const NODES: ParamDef = {
	key: "nodes",
	label: "Nodes",
	options: [100, 500, 1000, 2000, 5000, 10000],
	default: 1000,
};

const POINTS: ParamDef = {
	key: "nodes",
	label: "Nodes",
	options: [1000, 10000, 100000, 1000000],
	default: 10000,
};

const BATCHED: ParamDef = {
	key: "batched",
	label: "Batched",
	options: [0, 1],
	default: 1,
};

export interface Benchmark {
	id: string;
	title: string;
	blurb: string;
	params: ParamDef[];
	Scene: Component<BenchSceneProps>;
}

export const BENCHMARKS: Benchmark[] = [
	{
		id: "all-moving",
		title: "Every node moves",
		blurb:
			"N circles, each re-positioned every frame. Worst case for per-change cost: all of it is useful work.",
		params: [NODES],
		Scene: NextAllMoving,
	},
	{
		id: "one-moving",
		title: "One moves among many",
		blurb:
			"N static rectangles and one moving dot. Cost should track what changed; if it grows with N, the whole scene is being re-collected.",
		params: [NODES],
		Scene: NextOneMoving,
	},
	{
		id: "camera-pan",
		title: "Camera pan and zoom",
		blurb:
			"N static circles under a stage whose centre and zoom animate every frame. Specs are in scene units and the view matrix is applied at paint, so update cost should be ~0 and flat in N; only paint scales.",
		params: [NODES],
		Scene: NextCameraPan,
	},
	{
		id: "churn",
		title: "Mount / unmount churn",
		blurb:
			"The whole set of N circles is torn down and rebuilt every K frames. Look at the max and p95, not the median: the cost lands on a few frames.",
		params: [
			{ ...NODES, options: [100, 500, 1000, 2000, 5000], default: 500 },
			{
				key: "every",
				label: "Rebuild every (frames)",
				options: [10, 30, 60],
				default: 30,
			},
		],
		Scene: NextChurn,
	},
	{
		id: "reorder",
		title: "Reorder a keyed list",
		blurb:
			"N rects in a keyed <For> whose order is shuffled every K frames: the DOM anchors move, and paint order must follow them.",
		params: [
			{ ...NODES, options: [1000, 5000, 10000], default: 5000 },
			{
				key: "every",
				label: "Rebuild every (frames)",
				options: [10, 30, 60],
				default: 30,
			},
		],
		Scene: NextReorder,
	},
	{
		id: "scatter-pan",
		title: "Scatter: chart pan and zoom",
		blurb:
			"A scatter of N points whose x window pans and zooms every frame, so every marker re-projects: the chart-zoom path.",
		params: [POINTS, BATCHED],
		Scene: NextScatterPan,
	},
	{
		id: "scatter-transition",
		title: "Scatter: keyed transition",
		blurb:
			"N markers blending between two datasets every frame, matched by key.",
		params: [POINTS, BATCHED],
		Scene: NextScatterTransition,
	},
	{
		id: "number-plane-pan",
		title: "Number plane: sliding ranges",
		blurb:
			"A number plane with 120 major and minor grid lines per axis whose ranges slide every frame: every grid line moves, and lines enter and leave.",
		params: [],
		Scene: NextNumberPlanePan,
	},
];

export function findBenchmark(id: string): Benchmark | undefined {
	return BENCHMARKS.find((bench) => bench.id === id);
}
