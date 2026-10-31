/**
 * Node-side micro-benchmark of a batched `scatter` in a `chart`: one
 * instances node of 10k and of 100k markers, panned by writing a new
 * `xRange` every frame, and separately driven through a `{ from, to, t }`
 * range transition. Headless graph: no renderer, no paint; each sample is
 * the write plus the commit (the chart refits, the scatter re-projects and
 * republishes its marks spec).
 *
 * Bundle and run from `packages/charts` (the bundle goes under the
 * package's `node_modules` so its dependencies resolve):
 *
 *   npx vite build --ssr scripts/bench-scatter.ts --outDir node_modules/.bench --emptyOutDir
 *   node node_modules/.bench/bench-scatter.js [10000 100000 ...]
 *
 * Node's numbers run higher than Chromium's for the same work; compare runs
 * with each other.
 */

import {
	clockContext,
	createClock,
	reducedMotionContext,
	themeContext,
	track,
} from "@sophistry/core";
import { SceneGraph } from "@sophistry/core/internal";
import { resolveTheme } from "@sophistry/core/themes";
import { chart } from "../src/chart";
import { scatter } from "../src/points/scatter";

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
	graph.root.provide(
		clockContext,
		createClock({ reducedMotion: "no-preference" }),
	);
	graph.root.provide(reducedMotionContext, track(false));
	return graph;
}

function quantile(sorted: number[], q: number): number {
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
	);
}

function report(name: string, mount: number, samples: number[]): void {
	const sorted = samples.slice().sort((a, b) => a - b);
	const format = (value: number) => value.toFixed(2).padStart(8);
	console.log(
		`${name.padEnd(28)} mount ${format(mount)} ms  p50 ${format(quantile(sorted, 0.5))}  p90 ${format(quantile(sorted, 0.9))}  max ${format(sorted[sorted.length - 1] ?? 0)}  (n=${samples.length})`,
	);
}

function data(count: number) {
	const next = random(count);
	return Array.from({ length: count }, () => ({
		x: next() * 100,
		y: next() * 100,
	}));
}

/** Mounts a chart with one scatter, then times `frames` writes + commits. */
function run(
	name: string,
	count: number,
	frames: number,
	write: (plot: ReturnType<typeof chart.create>, frame: number) => void,
): void {
	const graph = headlessGraph();
	const start = performance.now();
	const plot = chart.create({
		width: 14,
		height: 8,
		xRange: [0, 100],
		yRange: [0, 100],
		clip: true,
		children: [
			scatter.create({ data: data(count), x: "x", y: "y", radius: 0.03 }),
		],
	});
	graph.root.add(plot);
	graph.commit();
	const mount = performance.now() - start;
	const samples: number[] = [];
	for (let frame = 1; frame <= frames; frame++) {
		const before = performance.now();
		write(plot, frame);
		graph.commit();
		samples.push(performance.now() - before);
	}
	report(name, mount, samples);
	plot.dispose();
}

const counts = process.argv
	.slice(2)
	.map(Number)
	.filter((n) => n > 0);
for (const count of counts.length > 0 ? counts : [10_000, 100_000]) {
	const frames = count >= 100_000 ? 60 : 120;
	run(`pan ${count}`, count, frames, (plot, frame) => {
		const shift = frame * 0.25;
		plot.set("xRange", [shift, 100 + shift]);
	});
	run(`range transition ${count}`, count, frames, (plot, frame) => {
		plot.set("xRange", { from: [0, 100], to: [25, 75], t: frame / frames });
	});
}
