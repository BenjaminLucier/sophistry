/**
 * `instances()`: typing of channels, spec selection, placement equal to the
 * equivalent single nodes, keyed enter/update/exit, tweens, staggers and
 * springs on a manual clock, the active set, `animateItem`, promote/demote,
 * item events, reduced motion, and per-item reveals and dash offsets.
 */

import { describe, expect, it, vi } from "vitest";
import { arcCurvePath, type Point, type Polyline } from "../geometry/index.js";
import type { ScenePointerEvent } from "../interact/types.js";
import { track } from "../reactive/index.js";
import { circle, ellipse } from "../shapes/circle.js";
import { dot } from "../shapes/dot.js";
import { dashedLine } from "../shapes/line.js";
import type { MarksSpec, ShapeSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import type { Clock } from "../tween/clock.js";
import { createClock } from "../tween/clock.js";
import {
	clockContext,
	Invalidate,
	reducedMotionContext,
	themeContext,
} from "./context.js";
import { SceneGraph } from "./graph.js";
import { group } from "./group.js";
import { instances } from "./instances.js";
import {
	defineShape,
	type ShapeInstanceable,
	type ShapeProps,
	shapeProps,
} from "./shape.js";

const theme = resolveTheme({ mode: "dark" });

/** A graph committed by hand, with a manual clock and motion allowed. */
function setup(options: { reduced?: boolean } = {}) {
	const graph = new SceneGraph({ schedule: () => {} });
	const clock = createClock({ reducedMotion: "no-preference" });
	let listeners = 0;
	const counted: Clock = {
		...clock,
		onTick(listener) {
			listeners++;
			const stop = clock.onTick(listener);
			return () => {
				listeners--;
				stop();
			};
		},
	};
	graph.root.provide(themeContext, theme);
	graph.root.provide(clockContext, counted);
	const reduced = track(options.reduced ?? false);
	graph.root.provide(reducedMotionContext, reduced);
	return {
		graph,
		clock,
		reduced,
		listeners: () => listeners,
		commit: () => graph.commit(),
		/** Advances the clock and commits. */
		step: (dt: number) => {
			clock.advance(dt);
			graph.commit();
		},
	};
}

/** A disc shape that declares the circle mark adapter and its instanceable keys. */
interface DiscProps extends ShapeProps {
	center?: Point;
	radius?: number;
	label?: string;
}

const disc = defineShape<DiscProps, ShapeInstanceable | "center" | "radius">({
	name: "Disc",
	props: {
		...shapeProps,
		center: { invalidates: Invalidate.TRANSFORM, instanceable: true },
		radius: {
			default: 1,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		label: { invalidates: Invalidate.NONE },
	},
	geometry: (props) => ({
		closed: true,
		curvePaths: [
			{
				...arcCurvePath(0, 0, props.radius ?? 1, 0, Math.PI * 2),
				closed: true,
			},
		],
	}),
	offset: (props) => props.center,
	instanceMark: (props) => ({ kind: "circle", radius: props.radius ?? 1 }),
});

/** A box shape with the rect adapter. */
interface BoxProps extends ShapeProps {
	center?: Point;
	width: number;
	height: number;
}

const box = defineShape<BoxProps>({
	name: "Box",
	props: {
		...shapeProps,
		center: { invalidates: Invalidate.TRANSFORM, instanceable: true },
		width: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		height: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	},
	geometry: (props) => ({
		closed: true,
		polylines: [
			[
				{ x: -props.width / 2, y: -props.height / 2 },
				{ x: props.width / 2, y: -props.height / 2 },
				{ x: props.width / 2, y: props.height / 2 },
				{ x: -props.width / 2, y: props.height / 2 },
			],
		],
	}),
	offset: (props) => props.center,
	instanceMark: (props) => ({
		kind: "rect",
		halfWidth: props.width / 2,
		halfHeight: props.height / 2,
	}),
});

interface Datum {
	id: string;
	x: number;
	y?: number;
	r?: number;
	color?: string;
}

const data: Datum[] = [
	{ id: "a", x: 0, color: "#ff0000" },
	{ id: "b", x: 1, color: "#00ff00" },
	{ id: "c", x: 2, color: "#0000ff" },
];

function specOf(node: { spec?: unknown } | object): MarksSpec {
	return (node as { spec: MarksSpec }).spec;
}

/** Item `i`'s outline points in scene units. */
function placed(spec: MarksSpec, i: number): Polyline[] {
	const shape = spec.shape;
	const outline =
		shape.kind === "paths"
			? shape.outlines[i]
			: shape.kind === "outline"
				? shape
				: null;
	if (!outline) throw new Error("not an outline mark");
	const t = spec.transforms;
	const [a, b, c, d] = t
		? [t[4 * i], t[4 * i + 1], t[4 * i + 2], t[4 * i + 3]]
		: [1, 0, 0, 1];
	const x = spec.centers[2 * i];
	const y = spec.centers[2 * i + 1];
	return outline.polylines.map((line) =>
		line.map((p) => ({ x: x + a * p.x + c * p.y, y: y + b * p.x + d * p.y })),
	);
}

function expectPolylinesClose(actual: Polyline[], expected: Polyline[]): void {
	expect(actual.length).toBe(expected.length);
	actual.forEach((line, i) => {
		expect(line.length).toBe(expected[i].length);
		line.forEach((p, k) => {
			expect(p.x).toBeCloseTo(expected[i][k].x, 12);
			expect(p.y).toBeCloseTo(expected[i][k].y, 12);
		});
	});
}

describe("instances: typing and validation", () => {
	it("types channels by the definition's instanceable keys", () => {
		const ok = () =>
			instances(disc, {
				data,
				channels: { center: (d) => ({ x: d.x, y: 0 }), radius: () => 1 },
			});
		const bad = () =>
			instances(disc, {
				data,
				// @ts-expect-error `label` is not instanceable on Disc
				channels: { label: (d) => d.id },
			});
		expect(ok).not.toThrow();
		expect(bad).toThrow(/not an instanceable prop of Disc/);
	});

	it("rejects a non-instanceable channel at run time too", () => {
		// Circle declares its instanceable keys, so these are also type errors;
		// the run-time check covers untyped callers.
		expect(() =>
			// @ts-expect-error `dash` is not instanceable
			instances(circle, { data, channels: { dash: () => [0.1] } }),
		).toThrow(/"dash" is not an instanceable prop of Circle/);
	});

	it("rejects a definition that is not a shape", () => {
		expect(() => instances(group as never, { data })).toThrow(/not a shape/);
	});

	it("rejects gradient fills on items", () => {
		const { graph, commit } = setup();
		const node = instances(circle, {
			data,
			shared: {
				radius: 1,
				fill: {
					kind: "gradient",
					type: "linear",
					from: { x: 0, y: 0 },
					to: { x: 1, y: 0 },
					stops: [],
				} as never,
			},
		});
		graph.root.add(node);
		expect(commit).toThrow(/gradient/);
	});
});

describe("instances: spec selection", () => {
	it("emits circle marks through the shape's adapter", () => {
		const { graph, commit } = setup();
		const node = instances(disc, {
			data,
			key: (d) => d.id,
			channels: { center: (d) => ({ x: d.x, y: 0 }), fill: (d) => d.color },
			shared: { radius: 0.5, stroke: "none" },
		});
		graph.root.add(node);
		commit();
		const spec = specOf(node);
		expect(spec.shape.kind).toBe("circle");
		expect([...spec.centers]).toEqual([0, 0, 1, 0, 2, 0]);
		expect([...spec.extents]).toEqual([0.5, 0.5, 0.5]);
		expect(spec.fills).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
		expect(spec.transforms).toBeNull();
		expect(spec.strokes).toBeNull();
	});

	it("emits rect marks, and falls back to outlines when an item is rotated", () => {
		const { graph, commit } = setup();
		const node = instances(box, {
			data,
			channels: { center: (d) => ({ x: d.x, y: 0 }) },
			shared: { width: 2, height: 1 },
		});
		graph.root.add(node);
		commit();
		expect(specOf(node).shape.kind).toBe("rect");
		expect([...specOf(node).extents]).toEqual([1, 0.5, 1, 0.5, 1, 0.5]);
		node.set("shared", { width: 2, height: 1, rotation: 0.3 });
		commit();
		expect(specOf(node).shape.kind).toBe("outline");
	});

	it("emits one shared outline when no geometry prop varies, paths when one does", () => {
		const { graph, commit } = setup();
		// An ellipse has no mark adapter (a circle would take the disc path).
		const node = instances(ellipse, {
			data,
			channels: {
				center: (d) => ({ x: d.x, y: 0 }),
				radiusX: () => 1,
				radiusY: () => 1,
			},
		});
		graph.root.add(node);
		commit();
		const spec = specOf(node);
		expect(spec.shape.kind).toBe("outline");
		expect(spec.transforms).toBeNull();
		node.set("channels", {
			center: (d: Datum) => ({ x: d.x, y: 0 }),
			radiusX: (d: Datum) => 1 + d.x,
			radiusY: (d: Datum) => 1 + d.x,
		});
		commit();
		const paths = specOf(node);
		expect(paths.shape.kind).toBe("paths");
		// Reaches hold each outline (curve control points included): in
		// proportion to the radii.
		const [r1, r2, r3] = [...paths.extents];
		expect(r1).toBeGreaterThanOrEqual(1);
		expect(r2 / r1).toBeCloseTo(2, 12);
		expect(r3 / r1).toBeCloseTo(3, 12);
	});

	it("republishes the same spec object when nothing changed", () => {
		const { graph, commit } = setup();
		const node = instances(circle, {
			data,
			channels: { center: (d) => ({ x: d.x, y: 0 }) },
			shared: { radius: 1 },
		});
		graph.root.add(node);
		commit();
		const first = specOf(node);
		(node as unknown as { invalidate(bits: number): void }).invalidate(
			Invalidate.SPEC,
		);
		commit();
		expect(specOf(node)).toBe(first);
	});
});

describe("instances: placement equals single nodes", () => {
	const props = [
		{ center: { x: 1, y: 2 }, radius: 0.5, rotation: 0.4, scale: 1.5, x: 0.25 },
		{ center: { x: -1, y: 0 }, radius: 0.5, rotation: -1, scale: 0.75, y: 2 },
	];

	it("under a similarity space: same matrices as the nodes' local transforms", () => {
		const { graph, commit } = setup();
		const outer = group.create({ x: 3, rotation: 0.7, scale: 2 });
		graph.root.add(outer);
		// An ellipse has no mark adapter, so this exercises the outline path.
		const node = instances(ellipse, {
			data: props,
			channels: {
				center: (p) => p.center,
				rotation: (p) => p.rotation,
				scale: (p) => p.scale,
				x: (p) => p.x,
				y: (p) => p.y,
			},
			shared: { radiusX: 0.5, radiusY: 0.5 },
		});
		outer.add(node);
		const singles = props.map(({ radius: _radius, ...p }) =>
			outer.add(ellipse.create({ ...p, radiusX: 0.5, radiusY: 0.5 })),
		);
		commit();
		const spec = specOf(node);
		expect(spec.shape.kind).toBe("outline");
		singles.forEach((single, i) => {
			const local = (single.spec as ShapeSpec).local;
			if (!local) throw new Error("expected a local outline");
			const m = local.transform;
			expect(spec.centers[2 * i]).toBe(m.e);
			expect(spec.centers[2 * i + 1]).toBe(m.f);
			expect([
				...(spec.transforms as Float64Array).slice(4 * i, 4 * i + 4),
			]).toEqual([m.a, m.b, m.c, m.d]);
			expect(spec.style.strokeWidth).toBeGreaterThan(0);
		});
		// Per-item scales give per-item pen scales, hence widths.
		const widths = spec.strokeWidths as Float32Array;
		singles.forEach((single, i) => {
			expect(widths[i]).toBeCloseTo(
				(single.spec as ShapeSpec).style.strokeWidth,
				5,
			);
		});
	});

	it("under a skewing space: the same scene-unit outline points", () => {
		const { graph, commit } = setup();
		const outer = group.create({ rotation: 0.3 });
		const inner = group.create({ scale: 1, scaleY: 2 });
		outer.add(inner);
		graph.root.add(outer);
		const node = instances(circle, {
			data: props,
			channels: {
				center: (p) => p.center,
				rotation: (p) => p.rotation,
				scale: (p) => p.scale,
				x: (p) => p.x,
				y: (p) => p.y,
			},
			shared: { radius: 0.5 },
		});
		inner.add(node);
		const singles = props.map((p) => inner.add(circle.create(p)));
		commit();
		const spec = specOf(node);
		singles.forEach((single, i) => {
			const baked = single.spec as ShapeSpec;
			expect(baked.local).toBeUndefined();
			expectPolylinesClose(placed(spec, i), baked.polylines);
		});
	});

	it("applies styleProps per item: dot colours", () => {
		const { graph, commit } = setup();
		const dots = [
			{ center: { x: 0, y: 0 }, color: "#ff0000" },
			{ center: { x: 1, y: 0 }, color: "#00ff00" },
		];
		const node = instances(dot, {
			data: dots,
			channels: { center: (d) => d.center, color: (d) => d.color },
		});
		graph.root.add(node);
		const singles = dots.map((d) => graph.root.add(dot.create(d)));
		commit();
		const spec = specOf(node);
		singles.forEach((single, i) => {
			const style = (single.spec as ShapeSpec).style;
			expect((spec.fills as string[])[i]).toBe(style.fill);
		});
		// Strokes default to the colour at width 0: nothing strokes, no stroke arrays.
		expect(spec.strokes).toBeNull();
		expect(spec.strokeWidths).toBeNull();
		expect(spec.style.strokeWidth).toBe(0);
		// `dot` declares `instanceMark`: discs, centred where the single dots are.
		expect(spec.shape.kind).toBe("circle");
		expect(Array.from(spec.centers)).toEqual([0, 0, 1, 0]);
		expect(spec.extents[0]).toBeCloseTo(0.09, 12);
	});

	it("applies styleProps per item: dashed lines fit their own dashes", () => {
		const { graph, commit } = setup();
		const lines = [
			{ from: { x: 0, y: 0 }, to: { x: 2, y: 0 } },
			{ from: { x: 0, y: 1 }, to: { x: 3, y: 1 } },
		];
		const node = instances(dashedLine, {
			data: lines,
			channels: { from: (l) => l.from, to: (l) => l.to },
		});
		graph.root.add(node);
		const singles = lines.map((l) => graph.root.add(dashedLine.create(l)));
		commit();
		const spec = specOf(node);
		expect(spec.shape.kind).toBe("paths");
		const dashes = spec.dashes as readonly (readonly number[] | null)[];
		singles.forEach((single, i) => {
			const style = (single.spec as ShapeSpec).style;
			expect(dashes[i]).toEqual(style.dash);
			expect(spec.style.lineCap).toBe(style.lineCap);
			expectPolylinesClose(
				placed(spec, i),
				(single.spec as ShapeSpec).local?.polylines ??
					(single.spec as ShapeSpec).polylines,
			);
		});
	});
});

describe("instances: keyed enter, update and exit", () => {
	it("keeps exiting items among their old neighbours, then drops them", () => {
		const { graph, step, commit } = setup();
		const node = instances(circle, {
			data,
			key: (d) => d.id,
			channels: { center: (d) => ({ x: d.x, y: 0 }) },
			shared: { radius: 0.1 },
			transition: {
				duration: 1,
				easing: "linear",
				exit: { to: { opacity: 0 } },
			},
		});
		graph.root.add(node);
		commit();
		node.set("data", [data[0], data[2], { id: "d", x: 3 }]);
		commit();
		expect([0, 1, 2, 3].map((i) => node.keyAt(i))).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
		expect(node.indexOf("b")).toBe(1);
		step(0.5);
		expect(specOf(node).alphas?.[1]).toBeCloseTo(0.5);
		expect(specOf(node).alphas?.[0]).toBe(1);
		step(0.6);
		expect(node.count).toBe(3);
		expect([0, 1, 2].map((i) => node.keyAt(i))).toEqual(["a", "c", "d"]);
	});

	it("enters from enter.from and vanishes at once without an exit", () => {
		const { graph, step, commit } = setup();
		const node = instances(circle, {
			data: [data[0]],
			key: (d) => d.id,
			channels: { center: (d) => ({ x: d.x, y: 0 }) },
			shared: { radius: 0.1 },
			transition: {
				duration: 1,
				easing: "linear",
				enter: { from: { opacity: 0 } },
			},
		});
		graph.root.add(node);
		commit();
		// The first data enters too. One item: its opacity is the layer's.
		expect(specOf(node).alphas).toBeNull();
		expect(specOf(node).style.opacity).toBe(0);
		step(1);
		node.set("data", [data[1]]);
		commit();
		expect(node.count).toBe(1);
		expect(node.keyAt(0)).toBe("b");
		step(0.25);
		expect(specOf(node).style.opacity).toBeCloseTo(0.25);
	});

	it("follows a Readable of data", () => {
		const { graph, commit } = setup();
		const source = track<readonly Datum[]>(data);
		const node = instances(circle, {
			data: source,
			key: (d) => d.id,
			shared: { radius: 0.1 },
		});
		graph.root.add(node);
		commit();
		expect(node.count).toBe(3);
		source.set(data.slice(0, 1));
		commit();
		expect(node.count).toBe(1);
	});

	it("throws on duplicate keys", () => {
		const { graph, commit } = setup();
		graph.root.add(
			instances(circle, { data, key: () => 1, shared: { radius: 1 } }),
		);
		expect(commit).toThrow(/duplicate key/);
	});
});

describe("instances: tweens, staggers and springs", () => {
	function moving(
		transition: Parameters<
			typeof instances<object, never, never, Datum>
		>[1]["transition"],
	) {
		const env = setup();
		const node = instances(circle, {
			data,
			key: (d) => d.id,
			channels: {
				center: (d) => ({ x: d.x, y: d.y ?? 0 }),
				fill: (d) => d.color,
			},
			shared: { radius: 0.1 },
			transition: transition as never,
		});
		env.graph.root.add(node);
		env.commit();
		return { ...env, node };
	}
	const moved = data.map((d) => ({ ...d, y: 10 }));

	it("tweens changed channels with the easing", () => {
		const { node, step, commit } = moving({ duration: 1, easing: "linear" });
		node.set("data", moved);
		commit();
		step(0.25);
		expect(specOf(node).centers[1]).toBeCloseTo(2.5);
		step(0.75);
		expect(specOf(node).centers[1]).toBe(10);
		expect(node.itemValue("a", "center")).toEqual({ x: 0, y: 10 });
	});

	it("staggers by position among the items moving together", () => {
		const { node, step, commit } = moving({
			duration: 1,
			easing: "linear",
			stagger: 0.5,
		});
		node.set("data", moved);
		commit();
		step(0.5);
		const centers = specOf(node).centers;
		expect(centers[1]).toBeCloseTo(5);
		expect(centers[3]).toBeCloseTo(0);
		expect(centers[5]).toBeCloseTo(0);
		step(0.5);
		expect(specOf(node).centers[3]).toBeCloseTo(5);
	});

	it("tweens colours through RGBA and ends on the exact string", () => {
		const { node, step, commit } = moving({ duration: 1, easing: "linear" });
		node.set(
			"data",
			data.map((d) => ({ ...d, color: "#000000" })),
		);
		commit();
		step(0.5);
		expect((specOf(node).fills as string[])[0]).toBe("rgba(128, 0, 0, 1)");
		step(0.5);
		// Every item at rest on the same colour: one shared fill, as authored.
		expect(specOf(node).fills).toBe("#000000");
	});

	it("springs with the closed form and keeps velocity when retargeted", () => {
		const { node, step, commit } = moving({
			spring: { stiffness: 100, damping: 10 },
		});
		node.set("data", moved);
		commit();
		step(0.1);
		const early = specOf(node).centers[1];
		expect(early).toBeGreaterThan(0);
		expect(early).toBeLessThan(10);
		// Retarget back to 0 mid-flight: it keeps moving up first (momentum).
		node.set("data", data);
		commit();
		step(0.01);
		expect(specOf(node).centers[1]).toBeGreaterThan(early);
		for (let i = 0; i < 400; i++) step(0.01);
		expect(specOf(node).centers[1]).toBe(0);
	});
});

describe("instances: active set", () => {
	it("listens to the clock only while items move, and idle frames republish", () => {
		const { node, step, commit, listeners } = (() => {
			const env = setup();
			const n = instances(circle, {
				data,
				key: (d) => d.id,
				channels: { center: (d) => ({ x: d.x, y: d.y ?? 0 }) },
				shared: { radius: 0.1 },
				transition: { duration: 1 },
			});
			env.graph.root.add(n);
			env.commit();
			return { ...env, node: n };
		})();
		expect(listeners()).toBe(0);
		node.set("data", [{ ...data[0], y: 1 }, data[1], data[2]]);
		commit();
		expect(listeners()).toBe(1);
		step(1.1);
		expect(listeners()).toBe(0);
		const settled = specOf(node);
		step(1);
		expect(specOf(node)).toBe(settled);
	});

	it("advances only the moving items: unchanged columns keep their arrays", () => {
		const env = setup();
		const node = instances(circle, {
			data,
			key: (d) => d.id,
			channels: {
				center: (d) => ({ x: d.x, y: d.y ?? 0 }),
				fill: (d) => d.color,
			},
			shared: { radius: 0.1 },
			transition: { duration: 1 },
		});
		env.graph.root.add(node);
		env.commit();
		node.set("data", [{ ...data[0], y: 1 }, data[1], data[2]]);
		env.commit();
		env.step(0.1);
		const before = specOf(node);
		env.step(0.1);
		const after = specOf(node);
		expect(after).not.toBe(before);
		expect(after.centers).not.toBe(before.centers);
		// Only `center` moves: the fills array is kept.
		expect(after.fills).toBe(before.fills);
	});
});

describe("instances: animateItem, promote and demote", () => {
	it("animates one item until the next data change", () => {
		const { graph, step, commit } = setup();
		const node = instances(circle, {
			data,
			key: (d) => d.id,
			channels: { center: (d) => ({ x: d.x, y: 0 }) },
			shared: { radius: 0.1 },
		});
		graph.root.add(node);
		commit();
		node.animateItem(
			"b",
			{ center: { x: 1, y: 4 } },
			{ duration: 1, easing: "linear" },
		);
		commit();
		step(0.5);
		expect(specOf(node).centers[3]).toBeCloseTo(2);
		step(0.5);
		expect(specOf(node).centers[3]).toBe(4);
		// A new channel (`opacity`) is added on demand.
		node.animateItem("c", { opacity: 0.5 });
		commit();
		expect(specOf(node).alphas?.[2]).toBe(0.5);
		node.set("data", [...data]);
		commit();
		expect(specOf(node).centers[3]).toBe(0);
	});

	it("promotes an item to a real node next to the instances, and demotes it back", () => {
		const { graph, commit } = setup();
		const node = instances(circle, {
			data,
			key: (d) => d.id,
			channels: { center: (d) => ({ x: d.x, y: 0 }), fill: (d) => d.color },
			shared: { radius: 0.1 },
		});
		const after = graph.root.add(circle.create({ radius: 1 }));
		graph.root.add(node, after);
		commit();
		const promoted = node.promote("b");
		expect(node.promote("b")).toBe(promoted);
		expect(graph.root.children.indexOf(promoted)).toBe(
			graph.root.children.indexOf(node) + 1,
		);
		expect(promoted.get("center")).toEqual({ x: 1, y: 0 });
		expect(promoted.get("fill")).toBe("#00ff00");
		expect(promoted.get("radius")).toBe(0.1);
		commit();
		expect(specOf(node).alphas?.[1]).toBe(0);
		promoted.set("center", { x: 5, y: 5 });
		node.demote("b");
		commit();
		expect(promoted.disposed).toBe(true);
		expect(specOf(node).alphas).toBeNull();
		expect(node.itemValue("b", "center")).toEqual({ x: 5, y: 5 });
		expect(specOf(node).centers[2]).toBe(5);
	});
});

describe("instances: events", () => {
	it("gives item handlers the item and its key", () => {
		const { graph, commit } = setup();
		const shared = vi.fn();
		const onItem = vi.fn();
		const node = instances(circle, {
			data,
			key: (d) => d.id,
			channels: { center: (d) => ({ x: d.x, y: 0 }) },
			shared: { radius: 0.4, onTap: shared },
		});
		node.onItem("tap", onItem);
		graph.root.add(node);
		commit();
		const internals = node as unknown as {
			interactionHandlers(): { onTap?: (event: ScenePointerEvent) => void };
			wantsInteraction(): boolean;
		};
		expect(internals.wantsInteraction()).toBe(true);
		internals.interactionHandlers().onTap?.({ item: 2 } as ScenePointerEvent);
		expect(shared).toHaveBeenCalledWith(
			expect.objectContaining({ item: 2, key: "c" }),
		);
		expect(onItem).toHaveBeenCalledWith(
			expect.objectContaining({ item: 2, key: "c" }),
		);
	});
});

describe("instances: reduced motion", () => {
	it("jumps to the end and drops exits at once", () => {
		const { graph, commit, listeners } = setup({ reduced: true });
		const node = instances(circle, {
			data,
			key: (d) => d.id,
			channels: { center: (d) => ({ x: d.x, y: d.y ?? 0 }) },
			shared: { radius: 0.1 },
			transition: {
				duration: 1,
				exit: { to: { opacity: 0 } },
				enter: { from: { opacity: 0 } },
			},
		});
		graph.root.add(node);
		commit();
		expect(specOf(node).alphas).toBeNull();
		node.set("data", [{ ...data[0], y: 3 }]);
		commit();
		expect(node.count).toBe(1);
		expect(specOf(node).centers[1]).toBe(3);
		expect(listeners()).toBe(0);
	});
});

describe("instances: per-item reveals and dash offsets", () => {
	const revealData = data.map((d, i) => ({ ...d, progress: [0.5, 1, 0][i] }));

	it("publishes a progress channel as progresses, and null once all are at 1", () => {
		const { graph, commit } = setup();
		const node = instances(ellipse, {
			data: revealData,
			key: (d) => d.id,
			channels: {
				center: (d) => ({ x: d.x, y: 0 }),
				progress: (d) => d.progress,
			},
			shared: { radiusX: 1, radiusY: 0.5, progress: 0.8 },
		});
		graph.root.add(node);
		commit();
		const spec = specOf(node);
		expect(spec.shape.kind).toBe("outline");
		expect([...(spec.progresses as Float32Array)]).toEqual([0.5, 1, 0]);
		// The channel overrides the shared progress; there is no layer fade.
		expect(spec.progress).toBe(1);
		node.set(
			"data",
			revealData.map((d) => ({ ...d, progress: 1 })),
		);
		commit();
		expect(specOf(node).progresses ?? null).toBeNull();
		expect("progresses" in specOf(node)).toBe(false);
	});

	it("clamps reveals to 0..1 and keeps the arrays while only centres move", () => {
		const { graph, commit } = setup();
		const node = instances(ellipse, {
			data: revealData.map((d, i) => ({ ...d, progress: [-1, 0.25, 2][i] })),
			key: (d) => d.id,
			channels: {
				center: (d) => ({ x: d.x, y: 0 }),
				progress: (d) => d.progress,
			},
			shared: { radiusX: 1, radiusY: 1 },
		});
		graph.root.add(node);
		commit();
		const first = specOf(node);
		expect([...(first.progresses as Float32Array)]).toEqual([0, 0.25, 1]);
		node.set(
			"data",
			[-1, 0.25, 2].map((progress, i) => ({
				...(data[i] as Datum),
				x: i + 5,
				progress,
			})),
		);
		commit();
		const moved = specOf(node);
		expect(moved.centers).not.toBe(first.centers);
		expect(moved.progresses).toBe(first.progresses);
		expect(moved.shape).toBe(first.shape);
	});

	it("draws a circle layer from its outlines while revealing, then as discs again", () => {
		const { graph, commit } = setup();
		const node = instances(circle, {
			data: revealData,
			key: (d) => d.id,
			channels: {
				center: (d) => ({ x: d.x, y: 0 }),
				progress: (d) => d.progress,
			},
			shared: { radius: 0.5 },
		});
		graph.root.add(node);
		commit();
		const revealing = specOf(node);
		expect(revealing.shape.kind).toBe("outline");
		// The circle's own outline (a closed curve about its centre), placed
		// exactly where the disc would be.
		const reference = circle.create({ radius: 0.5, center: { x: 1, y: 0 } });
		graph.root.add(reference);
		commit();
		const single = (reference as unknown as { spec: ShapeSpec }).spec;
		expect(revealing.shape.kind === "outline" && revealing.shape.closed).toBe(
			true,
		);
		const itemPoints = placed(revealing, 1)[0] as Polyline;
		const nodePoints = (single.polylines as Polyline[])[0] as Polyline;
		expect(itemPoints.length).toBe(nodePoints.length);
		expect(itemPoints[0]?.x).toBeCloseTo(nodePoints[0]?.x as number, 12);
		expect(itemPoints[0]?.y).toBeCloseTo(nodePoints[0]?.y as number, 12);
		expect([...revealing.extents][0]).toBeGreaterThanOrEqual(0.5);
		// A moving centre while revealing keeps the outline arrays (the
		// renderer's arc-length tables key on them).
		node.set(
			"data",
			revealData.map((d) => ({ ...d, x: d.x + 1 })),
		);
		commit();
		const shifted = specOf(node);
		expect(shifted.shape).toBe(revealing.shape);
		node.set(
			"data",
			revealData.map((d) => ({ ...d, progress: 1 })),
		);
		commit();
		const revealed = specOf(node);
		expect(revealed.shape.kind).toBe("circle");
		expect(revealed.progresses ?? null).toBeNull();
		expect([...revealed.extents]).toEqual([0.5, 0.5, 0.5]);
	});

	it("tweens progress through a transition", () => {
		const { graph, commit, step } = setup();
		const node = instances(circle, {
			data: data.map((d) => ({ ...d, progress: 0 })),
			key: (d) => d.id,
			channels: {
				center: (d) => ({ x: d.x, y: 0 }),
				progress: (d) => d.progress,
			},
			shared: { radius: 0.5 },
			transition: { duration: 1, easing: "linear" },
		});
		graph.root.add(node);
		commit();
		expect([...(specOf(node).progresses as Float32Array)]).toEqual([0, 0, 0]);
		node.set(
			"data",
			data.map((d) => ({ ...d, progress: 1 })),
		);
		commit();
		step(0.25);
		const quarter = specOf(node);
		expect(quarter.shape.kind).toBe("outline");
		expect(quarter.progresses?.[0]).toBeCloseTo(0.25, 6);
		expect(node.itemValue("a", "progress")).toBeCloseTo(0.25, 12);
		step(0.5);
		expect(specOf(node).progresses?.[2]).toBeCloseTo(0.75, 6);
		step(0.5);
		expect(specOf(node).shape.kind).toBe("circle");
		expect(specOf(node).progresses ?? null).toBeNull();
	});

	it("enters items drawing from progress 0 and rests them at the shared progress", () => {
		const { graph, commit, step } = setup();
		const node = instances(circle, {
			data,
			key: (d) => d.id,
			channels: { center: (d) => ({ x: d.x, y: 0 }) },
			shared: { radius: 0.5, progress: 0.5 },
			transition: {
				duration: 1,
				easing: "linear",
				enter: { from: { progress: 0 } },
			},
		});
		graph.root.add(node);
		commit();
		step(0.5);
		// Halfway from 0 to the shared 0.5.
		expect(specOf(node).progresses?.[0]).toBeCloseTo(0.25, 6);
		expect(specOf(node).progress).toBe(1);
		step(0.6);
		// The items rest at the shared progress, as single shapes would.
		expect([...(specOf(node).progresses as Float32Array)]).toEqual([
			0.5, 0.5, 0.5,
		]);
		expect(specOf(node).progress).toBe(1);
	});

	it("reveals every item to a shared progress, as on a single shape", () => {
		const { graph, commit } = setup();
		const reveal = track(0.3);
		const node = instances(circle, {
			data,
			key: (d) => d.id,
			channels: { center: (d) => ({ x: d.x, y: 0 }) },
			shared: { radius: 0.5, stroke: "white", progress: reveal },
		});
		graph.root.add(node);
		commit();
		const spec = specOf(node);
		// Traced from the circle's own outline, not faded.
		expect(spec.shape.kind).toBe("outline");
		expect(spec.progress).toBe(1);
		expect(
			[...(spec.progresses as Float32Array)].map((v) => +v.toFixed(6)),
		).toEqual([0.3, 0.3, 0.3]);
		reveal.set(1);
		commit();
		expect(specOf(node).shape.kind).toBe("circle");
		expect(specOf(node).progresses ?? null).toBeNull();
		reveal.set(0.7);
		commit();
		const promoted = node.promote("b");
		expect(promoted.get("progress")).toBe(0.7);
	});

	it("hands a promoted node its item's progress channel value", () => {
		const { graph, commit } = setup();
		const node = instances(circle, {
			data: revealData,
			key: (d) => d.id,
			channels: {
				center: (d) => ({ x: d.x, y: 0 }),
				progress: (d) => d.progress,
			},
			shared: { radius: 0.5, progress: 0.9 },
		});
		graph.root.add(node);
		commit();
		expect(node.promote("a").get("progress")).toBe(0.5);
		expect(node.promote("c").get("progress")).toBe(0);
	});

	it("publishes a dashOffset channel as dashOffsets, scaled by each item's pen", () => {
		const { graph, commit } = setup();
		const node = instances(circle, {
			data,
			key: (d) => d.id,
			channels: {
				center: (d) => ({ x: d.x, y: 0 }),
				dashOffset: (d) => d.x * 0.1,
				scale: (d) => 1 + d.x,
			},
			shared: { radius: 0.5, stroke: "white", dash: [0.2, 0.1] },
		});
		graph.root.add(node);
		commit();
		const spec = specOf(node);
		const offsets = [...(spec.dashOffsets as Float32Array)];
		expect(offsets[0]).toBeCloseTo(0, 6);
		expect(offsets[1]).toBeCloseTo(0.1 * 2, 6);
		expect(offsets[2]).toBeCloseTo(0.2 * 3, 6);
		// The same offset everywhere: the shared style carries it.
		node.set("channels", {
			center: (d: Datum) => ({ x: d.x, y: 0 }),
			dashOffset: () => 0.05,
		});
		commit();
		const uniform = specOf(node);
		expect(uniform.dashOffsets ?? null).toBeNull();
		expect(uniform.style.dashOffset).toBeCloseTo(0.05, 12);
	});
});

describe("instances: steady updates (same keys, same order)", () => {
	const fresh = (shift: number, radius = 0.5) =>
		data.map((d) => ({ ...d, x: d.x + shift, r: radius }));

	function steady(channels: Record<string, (d: Datum) => unknown>) {
		const env = setup();
		const node = instances(circle, {
			data: fresh(0),
			key: (d) => d.id,
			channels: channels as never,
			shared: { stroke: "none" },
		});
		env.graph.root.add(node);
		env.commit();
		return { ...env, node };
	}

	it("re-places moved items and keeps their styles, sizes and spec arrays", () => {
		const { node, commit } = steady({
			center: (d) => ({ x: d.x, y: 0 }),
			radius: (d) => d.r,
			fill: (d) => d.color,
		});
		const first = specOf(node);
		node.set("data", fresh(1));
		commit();
		const moved = specOf(node);
		expect(moved).not.toBe(first);
		expect(moved.centers).not.toBe(first.centers);
		expect([...moved.centers]).toEqual([1, 0, 2, 0, 3, 0]);
		expect(moved.bounds).toEqual({
			minX: 0.5,
			minY: -0.5,
			maxX: 3.5,
			maxY: 0.5,
		});
		// Only centres moved: the styles and the unchanged sizes are kept.
		expect(moved.fills).toBe(first.fills);
		expect(moved.style).toBe(first.style);
		expect(moved.extents).toBe(first.extents);
		// The same values again: the same spec.
		node.set("data", fresh(1));
		commit();
		expect(specOf(node)).toBe(moved);
	});

	it("re-measures sizes when a geometry channel changes with the move", () => {
		const { node, commit } = steady({
			center: (d) => ({ x: d.x, y: 0 }),
			radius: (d) => d.r,
		});
		const first = specOf(node);
		node.set("data", fresh(1, 2));
		commit();
		const grown = specOf(node);
		expect([...grown.extents]).toEqual([2, 2, 2]);
		expect(grown.extents).not.toBe(first.extents);
	});

	it("keeps each item's own scale when items with different scales move", () => {
		const { node, commit } = steady({
			center: (d) => ({ x: d.x, y: 0 }),
			radius: () => 0.5,
			scale: (d) => 1 + d.x,
		});
		expect([...specOf(node).extents]).toEqual([0.5, 1, 1.5]);
		node.set("data", fresh(1));
		commit();
		// Scales follow the new data (x + 1), sizes stay 0.5 per unit scale.
		expect([...specOf(node).extents]).toEqual([1, 1.5, 2]);
	});

	it("re-places under a changed space and keeps the extents in step", () => {
		const env = setup();
		const outer = env.graph.root.add(group.create({ scale: 1 }));
		const node = instances(circle, {
			data: fresh(0),
			key: (d) => d.id,
			channels: { center: (d) => ({ x: d.x, y: 0 }) },
			shared: { radius: 0.5 },
		});
		outer.add(node);
		env.commit();
		outer.set("scale", 2);
		env.commit();
		expect([...specOf(node).extents]).toEqual([1, 1, 1]);
		node.set("data", fresh(1));
		env.commit();
		expect([...specOf(node).extents]).toEqual([1, 1, 1]);
		expect([...specOf(node).centers]).toEqual([2, 0, 4, 0, 6, 0]);
	});

	it("brings an exiting item back when the data returns to the same keys", () => {
		const { graph, commit, step } = setup();
		const node = instances(circle, {
			data,
			key: (d) => d.id,
			channels: { center: (d) => ({ x: d.x, y: 0 }) },
			shared: { radius: 0.1 },
			transition: { duration: 1, exit: { to: { opacity: 0 } } },
		});
		graph.root.add(node);
		commit();
		node.set("data", data.slice(0, 2));
		commit();
		step(0.5);
		expect(node.count).toBe(3);
		expect(specOf(node).alphas?.[2]).toBeCloseTo(0.5, 6);
		node.set("data", data);
		commit();
		step(1);
		expect(node.count).toBe(3);
		expect(specOf(node).alphas ?? null).toBeNull();
	});

	it("still throws on duplicate keys when the count is unchanged", () => {
		const { graph, commit } = setup();
		const node = instances(circle, {
			data,
			key: (d) => d.id,
			channels: { center: (d) => ({ x: d.x, y: 0 }) },
		});
		graph.root.add(node);
		commit();
		node.set("data", [data[0], data[0], data[2]] as Datum[]);
		expect(() => commit()).toThrow(/duplicate key/);
	});
});
