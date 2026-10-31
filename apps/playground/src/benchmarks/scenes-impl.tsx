/**
 * The benchmark scenes, built on `@sophistry/core`. Solid only hosts the
 * element here; the scene owns its canvas, renderer and frame-loop wiring.
 *
 * Each step commits the scene itself (`scene.commit()`), so the harness's
 * "update" covers the writes, the bindings' pulls, the stages and the frame
 * collection; the frame loop's own commit then finds nothing to do and its
 * rAF callback is the paint.
 */

import { chart, scatter } from "@sophistry/charts";
import {
	circle,
	createScene,
	derive,
	numberPlane,
	rect,
	type Scene,
	type SceneNode,
	type SceneOptions,
	track,
} from "@sophistry/core";
import { onCleanup, onSettled } from "solid-js";
import type { BenchSceneProps } from "./harness";

/** Cell centres of a grid filling the default 16 × 9 stage (as in `../scenes.tsx`). */
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

/** A Gaussian cloud of three groups (as `cloud` in `../scenes.tsx`). */
function cloud(count: number, seed = 1) {
	const next = random(seed);
	return Array.from({ length: count }, (_, i) => {
		const r = Math.sqrt(-2 * Math.log(next() + 1e-12));
		const a = next() * Math.PI * 2;
		return { x: r * Math.cos(a) * 3, y: r * Math.sin(a) * 2, group: i % 3 };
	});
}

/**
 * A scene mounted like `<Stage>` (full width, 16:9, device pixels). `build`
 * adds nodes and returns the per-frame step.
 */
function NextStage(props: {
	ready: BenchSceneProps["ready"];
	options?: SceneOptions;
	build: (scene: Scene) => (frame: number) => void;
}) {
	let host!: HTMLDivElement;
	onSettled(() => {
		const scene = createScene({ ...props.options, host });
		const step = props.build(scene);
		scene.commit();
		props.ready((frame) => {
			step(frame);
			scene.commit();
		});
		onCleanup(() => scene.dispose());
	});
	return <div ref={host} style={{ width: "100%" }} />;
}

export function NextAllMoving(props: BenchSceneProps) {
	return (
		<NextStage
			ready={props.ready}
			build={(scene) => {
				const points = gridPoints(props.config.nodes);
				const phase = track(0);
				points.forEach((point, index) => {
					scene.add(
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
				return (frame) => phase.set(frame * 0.08);
			}}
		/>
	);
}

export function NextOneMoving(props: BenchSceneProps) {
	return (
		<NextStage
			ready={props.ready}
			build={(scene) => {
				const points = gridPoints(props.config.nodes);
				const phase = track(0);
				points.forEach((point, index) => {
					scene.add(
						rect.create({
							center: { x: point.x, y: point.y },
							width: point.size * 0.8,
							height: point.size * 0.8,
							fill: hue(index, points.length),
						}),
					);
				});
				scene.add(
					circle.create({
						radius: 0.4,
						center: derive(phase, (p) => ({
							x: Math.sin(p) * 6,
							y: Math.cos(p) * 3,
						})),
					}),
				);
				return (frame) => phase.set(frame * 0.08);
			}}
		/>
	);
}

export function NextCameraPan(props: BenchSceneProps) {
	return (
		<NextStage
			ready={props.ready}
			build={(scene) => {
				const points = gridPoints(props.config.nodes);
				points.forEach((point, index) => {
					scene.add(
						circle.create({
							center: { x: point.x, y: point.y },
							radius: point.size * 0.3,
							fill: hue(index, points.length),
						}),
					);
				});
				return (frame) =>
					scene.setView({
						center: { x: Math.sin(frame * 0.03) * 3, y: 0 },
						units: 16 + Math.sin(frame * 0.02) * 5,
					});
			}}
		/>
	);
}

export function NextChurn(props: BenchSceneProps) {
	return (
		<NextStage
			ready={props.ready}
			build={(scene) => {
				const build = (): SceneNode[] =>
					gridPoints(props.config.nodes).map((point, index) =>
						circle.create({
							center: { x: point.x, y: point.y },
							radius: point.size * 0.3,
							fill: hue(index, props.config.nodes),
						}),
					);
				scene.root.setChildren(build());
				const every = props.config.every;
				return (frame) => {
					if (frame % every === 0) scene.root.setChildren(build());
				};
			}}
		/>
	);
}

export function NextReorder(props: BenchSceneProps) {
	return (
		<NextStage
			ready={props.ready}
			build={(scene) => {
				const points = gridPoints(props.config.nodes);
				const nodes = points.map((point, id) =>
					rect.create({
						center: { x: point.x, y: point.y },
						width: point.size * 0.8,
						height: point.size * 0.8,
						fill: hue(id, points.length),
					}),
				);
				scene.root.setChildren(nodes);
				const every = props.config.every;
				const next = random(5);
				return (frame) => {
					if (frame % every !== 0) return;
					const shuffled = nodes.slice();
					for (let i = shuffled.length - 1; i > 0; i--) {
						const j = Math.floor(next() * (i + 1));
						[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
					}
					scene.root.setChildren(shuffled);
				};
			}}
		/>
	);
}

/**
 * The chart's x window pans and zooms each frame: every marker re-projects
 * (`@sophistry/charts`, always batched).
 */
export function NextScatterPan(props: BenchSceneProps) {
	return (
		<NextStage
			ready={props.ready}
			build={(scene) => {
				const plot = chart.create({
					width: 14,
					height: 7.5,
					clip: true,
					xRange: [-10, 10],
					yRange: [-6, 6],
					children: [
						scatter.create({
							data: cloud(props.config.nodes),
							x: "x",
							y: "y",
							series: "group",
							radius: 0.04,
						}),
					],
				});
				scene.add(plot);
				return (frame) => {
					const half = 8 + Math.sin(frame * 0.02) * 3;
					const mid = Math.sin(frame * 0.03) * 2;
					plot.set("xRange", [mid - half, mid + half]);
				};
			}}
		/>
	);
}

/** A keyed transition between two clouds, blended every frame. */
export function NextScatterTransition(props: BenchSceneProps) {
	return (
		<NextStage
			ready={props.ready}
			build={(scene) => {
				const from = cloud(props.config.nodes, 1).map((d, i) => ({
					...d,
					id: i,
				}));
				const to = cloud(props.config.nodes, 2).map((d, i) => ({
					...d,
					id: i,
				}));
				const markers = scatter.create({
					data: from,
					to,
					blend: 0,
					key: "id",
					x: "x",
					y: "y",
					series: "group",
					radius: 0.04,
				});
				scene.add(
					chart.create({
						width: 14,
						height: 7.5,
						xRange: [-10, 10],
						yRange: [-6, 6],
						children: [markers],
					}),
				);
				return (frame) =>
					markers.set("blend", 0.5 - Math.cos(frame * 0.05) * 0.5);
			}}
		/>
	);
}

/**
 * A dense number plane (120 major and minor grid lines per axis) whose ranges
 * slide a quarter step per frame, so its grid lines move every frame and
 * enter and leave every few: the coordinate-grid pan path.
 */
export function NextNumberPlanePan(props: BenchSceneProps) {
	return (
		<NextStage
			ready={props.ready}
			build={(scene) => {
				const plane = numberPlane.create({
					xRange: [-60, 60, 1],
					yRange: [-60, 60, 1],
					width: 16,
					height: 9,
					minorGridLineCount: 1,
				});
				scene.add(plane);
				return (frame) => {
					const shift = frame * 0.25;
					plane.update({
						xRange: [-60 + shift, 60 + shift, 1],
						yRange: [-60 + shift, 60 + shift, 1],
					});
				};
			}}
		/>
	);
}
