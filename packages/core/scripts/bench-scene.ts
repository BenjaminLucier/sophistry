/**
 * Node-side micro-benchmark of the scene graph's hot paths, mirroring the
 * playground's `all-moving`, `churn` and `reorder` scenarios
 * (`apps/playground/src/benchmarks/scenes.tsx`) on a headless graph: no
 * renderer, no paint, just the writes, pulls, stages and frame collection.
 * `instances-pan` is one `instances()` node of 100k discs handed a fresh
 * array of fresh items every frame (same keys, same order, new centres), as
 * a batched chart mark is when its range pans.
 *
 * `number-plane-pan` is a dense `numberPlane` (120 major and as many minor
 * grid lines per axis, the cap) whose ranges slide a quarter step per frame,
 * so every few frames its grid keys change (lines enter and leave); its
 * mount is the first row's `mount`.
 *
 * Bundle and run from `packages/core` (add `--cpu-prof` to profile). The
 * bundle goes under the package's `node_modules` so its dependencies
 * (d3-*) resolve:
 *
 *   npx vite build --ssr scripts/bench-scene.ts --outDir node_modules/.bench --emptyOutDir
 *   node node_modules/.bench/bench-scene.js [all-moving|churn|reorder ...]
 *
 * Node's numbers run higher than Chromium's for the same work; compare runs
 * with each other, and confirm in the browser with `e2e/bench.mjs`.
 */

import { numberPlane } from "../src/coords";
import { derive, track } from "../src/reactive";
import { themeContext } from "../src/scene/context";
import { SceneGraph } from "../src/scene/graph";
import { instances } from "../src/scene/instances";
import type { SceneNode } from "../src/scene/types";
import { circle, rect } from "../src/shapes";
import { resolveTheme } from "../src/themes";

function gridPoints(count: number): { x: number; y: number; size: number }[] {
	const cols = Math.max(1, Math.ceil(Math.sqrt((count * 16) / 9)));
	const rows = Math.ceil(count / cols);
	const size = Math.min(14 / cols, 8 / rows);
	return Array.from({ length: count }, (_, i) => ({
		x: ((i % cols) - (cols - 1) / 2) * size,
		y: (Math.floor(i / cols) - (rows - 1) / 2) * size,
		size,
	}));
}

const hue = (i: number, count: number) =>
	`hsl(${Math.round((i / count) * 300)} 65% 55%)`;

function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

function headlessGraph(): SceneGraph {
	const graph = new SceneGraph({ schedule: () => {}, onFrame: () => {} });
	graph.root.provide(themeContext, resolveTheme({ mode: "dark" }));
	return graph;
}

function quantile(sorted: number[], q: number): number {
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
	);
}

function report(name: string, mount: number, samples: number[]): void {
	const sorted = samples.slice().sort((a, b) => a - b);
	const format = (value: number) => value.toFixed(2).padStart(7);
	console.log(
		`${name.padEnd(22)} mount ${format(mount)} ms  p50 ${format(quantile(sorted, 0.5))}  p90 ${format(quantile(sorted, 0.9))}  max ${format(sorted[sorted.length - 1] ?? 0)}  (n=${samples.length})`,
	);
}

/** Runs `build` once (timed as mount), then `step` for `frames` frames, timing each step + commit. */
function run(
	name: string,
	frames: number,
	build: (graph: SceneGraph) => (frame: number) => boolean,
): void {
	const graph = headlessGraph();
	const start = performance.now();
	const step = build(graph);
	graph.commit();
	const mount = performance.now() - start;
	const samples: number[] = [];
	for (let frame = 1; frame <= frames; frame++) {
		const before = performance.now();
		const record = step(frame);
		graph.commit();
		const elapsed = performance.now() - before;
		if (record) samples.push(elapsed);
	}
	report(name, mount, samples);
	graph.dispose();
}

const scenarios: Record<string, () => void> = {
	"all-moving": () =>
		run("all-moving 10k", 300, (graph) => {
			const points = gridPoints(10000);
			const phase = track(0);
			points.forEach((point, index) => {
				graph.root.add(
					circle.create({
						radius: point.size * 0.3,
						fill: hue(index, points.length),
						center: derive(phase, (p) => ({
							x: point.x + Math.sin(p + index) * point.size * 0.3,
							y: point.y + Math.cos(p + index) * point.size * 0.3,
						})),
					}),
				);
			});
			return (frame) => {
				phase.set(frame * 0.08);
				return true;
			};
		}),
	churn: () =>
		run("churn 5000 (rebuilds)", 600, (graph) => {
			const build = (): SceneNode[] =>
				gridPoints(5000).map((point, index) =>
					circle.create({
						center: { x: point.x, y: point.y },
						radius: point.size * 0.3,
						fill: hue(index, 5000),
					}),
				);
			graph.root.setChildren(build());
			return (frame) => {
				if (frame % 30 !== 0) return false;
				graph.root.setChildren(build());
				return true;
			};
		}),
	reorder: () =>
		run("reorder 10k (shuffles)", 900, (graph) => {
			const points = gridPoints(10000);
			const nodes: SceneNode[] = points.map((point, id) =>
				rect.create({
					center: { x: point.x, y: point.y },
					width: point.size * 0.8,
					height: point.size * 0.8,
					fill: hue(id, points.length),
				}),
			);
			graph.root.setChildren(nodes);
			const next = random(5);
			return (frame) => {
				if (frame % 30 !== 0) return false;
				const shuffled = nodes.slice();
				for (let i = shuffled.length - 1; i > 0; i--) {
					const j = Math.floor(next() * (i + 1));
					[shuffled[i], shuffled[j]] = [
						shuffled[j] as SceneNode,
						shuffled[i] as SceneNode,
					];
				}
				graph.root.setChildren(shuffled);
				return true;
			};
		}),
	"instances-pan": () =>
		run("instances-pan 100k", 120, (graph) => {
			const points = gridPoints(100_000);
			const itemsAt = (shift: number) =>
				points.map((point, id) => ({
					id,
					center: { x: point.x + shift, y: point.y },
					radius: point.size * 0.3,
					fill: hue(id % 64, 64),
					opacity: 1,
				}));
			const node = instances(circle, {
				data: itemsAt(0),
				key: (item) => item.id,
				channels: {
					center: (item) => item.center,
					radius: (item) => item.radius,
					fill: (item) => item.fill,
					opacity: (item) => item.opacity,
				},
				shared: { stroke: "none" },
			});
			graph.root.add(node);
			// Two prebuilt frames, alternated: the timing is the node's, not
			// the items' allocation.
			const frames = [itemsAt(0.01), itemsAt(0.02)];
			return (frame) => {
				node.set("data", frames[frame % 2] as ReturnType<typeof itemsAt>);
				return true;
			};
		}),
	"number-plane-pan": () =>
		run("number-plane-pan", 120, (graph) => {
			const plane = numberPlane.create({
				xRange: [-60, 60, 1],
				yRange: [-60, 60, 1],
				width: 16,
				height: 9,
				minorGridLineCount: 1,
			});
			graph.root.add(plane);
			return (frame) => {
				const shift = frame * 0.25;
				plane.update({
					xRange: [-60 + shift, 60 + shift, 1],
					yRange: [-60 + shift, 60 + shift, 1],
				});
				return true;
			};
		}),
};

declare const process: { argv: string[] };

const requested = process.argv.slice(2);
for (const name of requested.length > 0 ? requested : Object.keys(scenarios)) {
	const scenario = scenarios[name];
	if (!scenario) throw new Error(`Unknown scenario "${name}".`);
	scenario();
}
