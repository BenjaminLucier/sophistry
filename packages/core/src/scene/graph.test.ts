/**
 * The node machinery and the commit engine, on a toy drawable whose spec is
 * a function of its props: bindings coalesce, stages rerun only for their
 * bits, the collector matches `compileFrame`, disposal ends subscriptions.
 */

import { describe, expect, it } from "vitest";
import { derive, track } from "../reactive";
import { compileFrame } from "../spec/compile";
import type { DrawSpec, ShapeSpec } from "../spec/types";
import type { CompositeContext } from "./composite";
import { defineComposite } from "./composite";
import { BaseContainer } from "./container";
import { createContextKey, Invalidate, themeContext } from "./context";
import { SceneGraph } from "./graph";
import { BaseNode } from "./node";
import { definePrimitive } from "./primitive";
import type { InvalidateBits } from "./types";

interface ToyProps {
	size?: number;
	zIndex?: number;
	visible?: boolean;
	label?: string;
}

/** Counts how often each stage ran; publishes a minimal shape spec. */
class ToyNode extends BaseNode<ToyProps> {
	override readonly producesSpec = true;
	runs = { geometry: 0, spec: 0, theme: 0 };
	protected run(dirty: InvalidateBits): void {
		if (dirty & Invalidate.GEOMETRY) this.runs.geometry++;
		if (dirty & Invalidate.STYLE) this.runs.theme++;
		this.runs.spec++;
		if (this.props.visible === false) {
			this.publish(null);
			return;
		}
		this.publish({
			kind: "shape",
			id: this.id,
			zIndex: this.props.zIndex ?? 0,
			polylines: [],
			closed: false,
			fillFrom: 0,
			style: undefined as unknown as ShapeSpec["style"],
			progress: 1,
		} as ShapeSpec);
	}
	protected override stagesForContext(key: unknown): InvalidateBits {
		return key === themeContext ? Invalidate.STYLE : 0;
	}
}

const toy = definePrimitive<ToyProps, ToyNode>({
	name: "Toy",
	props: {
		size: { default: 1, invalidates: Invalidate.GEOMETRY },
		zIndex: { default: 0, invalidates: Invalidate.SPEC },
		visible: { default: true, invalidates: Invalidate.SPEC },
		label: { invalidates: Invalidate.INTERACTION },
	},
	node: (definition) => new ToyNode(definition),
});

class PlainContainer extends BaseContainer<{
	children?: readonly BaseNode[];
}> {}
const box = definePrimitive<{ children?: readonly BaseNode[] }, PlainContainer>(
	{
		name: "Box",
		container: true,
		props: { children: { kind: "children", invalidates: 0 } },
		node: (definition) => new PlainContainer(definition),
	},
);

/** A graph that commits only when the test says so. */
function manualGraph() {
	let pending = false;
	const frames: { frame: readonly DrawSpec[]; membershipChanged: boolean }[] =
		[];
	const graph = new SceneGraph({
		schedule: () => {
			pending = true;
		},
		onFrame: (frame, options) => frames.push({ frame, ...options }),
	});
	return {
		graph,
		frames,
		pending: () => pending,
		commit: () => {
			pending = false;
			return graph.commit();
		},
	};
}

/** The frame `compileFrame` would build from the graph's drawables. */
function reference(graph: SceneGraph): DrawSpec[] {
	return compileFrame(
		graph.ordered.map((node) => ({ id: node.id, spec: () => node.spec })),
	);
}

describe("SceneGraph", () => {
	it("commits added nodes in tree order and does nothing when clean", () => {
		const { graph, commit, frames } = manualGraph();
		const a = graph.root.add(toy.create({ size: 1 }));
		const b = graph.root.add(toy.create({ size: 2 }));
		expect(commit()).toBe(true);
		expect(frames.at(-1)?.frame.map((spec) => spec.id)).toEqual([a.id, b.id]);
		const commits = graph.stats.commits;
		expect(commit()).toBe(false);
		expect(graph.stats.commits).toBe(commits);
	});

	it("reruns only the stage a prop invalidates", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(toy.create({ size: 1 }));
		commit();
		const geometry = node.runs.geometry;
		node.set("zIndex", 2);
		commit();
		expect(node.runs.geometry).toBe(geometry);
		node.set("size", 3);
		commit();
		expect(node.runs.geometry).toBe(geometry + 1);
	});

	it("coalesces three writes to a bound track into one update", () => {
		const { graph, commit } = manualGraph();
		const size = track(1);
		const node = graph.root.add(toy.create({ size }));
		commit();
		const runs = node.runs.spec;
		size.set(2);
		size.set(3);
		size.set(4);
		commit();
		expect(node.runs.spec).toBe(runs + 1);
		expect(node.get("size")).toBe(4);
	});

	it("an equal pulled value invalidates nothing", () => {
		const { graph, commit } = manualGraph();
		const source = track(1);
		const parity = derive(source, (value) => value % 2);
		const node = graph.root.add(toy.create({ zIndex: parity }));
		commit();
		const runs = node.runs.spec;
		source.set(3);
		commit();
		expect(node.runs.spec).toBe(runs);
	});

	it("patches zIndex and visibility changes to match compileFrame", () => {
		const { graph, commit, frames } = manualGraph();
		const nodes = Array.from({ length: 8 }, (_, i) =>
			graph.root.add(toy.create({ zIndex: i % 3 })),
		);
		commit();
		const rebuilds = graph.stats.rebuilds;
		nodes[2]?.set("zIndex", 5);
		nodes[5]?.set("visible", false);
		commit();
		expect(frames.at(-1)?.frame).toEqual(reference(graph));
		expect(frames.at(-1)?.membershipChanged).toBe(true);
		// Spliced, not re-sorted from scratch (counted as one rebuild of order).
		expect(graph.stats.rebuilds).toBe(rebuilds + 1);
		nodes[5]?.set("visible", true);
		nodes[0]?.set("zIndex", -1);
		commit();
		expect(frames.at(-1)?.frame).toEqual(reference(graph));
	});

	it("an in-place patch keeps membership and returns a new array", () => {
		const { graph, commit, frames } = manualGraph();
		const node = graph.root.add(toy.create({}));
		graph.root.add(toy.create({}));
		commit();
		const before = frames.at(-1)?.frame;
		node.set("size", 4);
		commit();
		const after = frames.at(-1);
		expect(after?.frame).not.toBe(before);
		expect(after?.membershipChanged).toBe(false);
	});

	it("orders nested containers depth first", () => {
		const { graph, commit, frames } = manualGraph();
		const first = toy.create({});
		const inner = toy.create({});
		const last = toy.create({});
		graph.root.add(first);
		graph.root.add(box.create({ children: [inner] }));
		graph.root.add(last);
		commit();
		expect(frames.at(-1)?.frame.map((spec) => spec.id)).toEqual([
			first.id,
			inner.id,
			last.id,
		]);
		// Reorder by identity: setChildren moves, nothing is disposed.
		graph.root.setChildren([last, ...graph.root.children.slice(0, 2)]);
		commit();
		expect(frames.at(-1)?.frame.map((spec) => spec.id)).toEqual([
			last.id,
			first.id,
			inner.id,
		]);
		expect(first.disposed).toBe(false);
	});

	it("disposing removes every subscription and the node from the frame", () => {
		const { graph, commit, frames } = manualGraph();
		let subscribers = 0;
		const source = track(1);
		const counted = {
			peek: () => source.peek(),
			subscribe(onStale: () => void) {
				subscribers++;
				const stop = source.subscribe(onStale);
				return () => {
					subscribers--;
					stop();
				};
			},
		};
		const node = graph.root.add(toy.create({ size: counted, zIndex: counted }));
		const watcher = node.readable("size").subscribe(() => {});
		commit();
		expect(subscribers).toBe(2);
		let disposed = 0;
		node.on("dispose", () => disposed++);
		node.dispose();
		watcher();
		expect(subscribers).toBe(0);
		expect(disposed).toBe(1);
		commit();
		expect(frames.at(-1)?.frame).toEqual([]);
		// Writes after disposal are ignored.
		source.set(5);
		expect(graph.needsCommit()).toBe(false);
	});

	it("setChildren disposes the nodes it drops", () => {
		const { graph, commit } = manualGraph();
		const keep = toy.create({});
		const drop = toy.create({});
		graph.root.setChildren([keep, drop]);
		commit();
		graph.root.setChildren([keep]);
		expect(drop.disposed).toBe(true);
		expect(keep.disposed).toBe(false);
	});

	it("tells descendants when a provided context value changes", () => {
		const { graph, commit } = manualGraph();
		const node = toy.create({});
		const container = box.create({ children: [node] });
		graph.root.add(container);
		commit();
		const theme = node.runs.theme;
		graph.root.provide(themeContext, { ...node.context(themeContext) });
		commit();
		expect(node.runs.theme).toBe(theme + 1);
		// A container providing the key itself shadows the change.
		container.provide(themeContext, node.context(themeContext));
		commit();
		const shadowed = node.runs.theme;
		graph.root.provide(themeContext, { ...node.context(themeContext) });
		commit();
		expect(node.runs.theme).toBe(shadowed);
	});

	it("rejects unknown props with the definition's name", () => {
		expect(() => toy.create({ size: 1 }).set("radius" as "size", 2)).toThrow(
			/Toy has no prop "radius"/,
		);
	});

	it("registers interactive nodes from props and on() handlers", () => {
		const { graph, commit } = manualGraph();
		const plain = graph.root.add(toy.create({}));
		const labelled = graph.root.add(toy.create({ label: "x" }));
		commit();
		expect([...graph.interactive]).toEqual([labelled]);
		const off = plain.on("tap", () => {});
		commit();
		expect(graph.interactive.has(plain)).toBe(true);
		off();
		commit();
		expect(graph.interactive.has(plain)).toBe(false);
	});
});

describe("defineComposite", () => {
	interface ListProps {
		items: readonly string[];
		zIndex?: number;
	}
	const listed = defineComposite<ListProps>({
		name: "Listed",
		props: {
			items: { default: [], invalidates: Invalidate.UPDATE },
			zIndex: { default: 0, invalidates: Invalidate.NONE },
		},
		setup: (ctx) => build(ctx),
		update: (changed, ctx) => (changed.has("items") ? build(ctx) : undefined),
	});
	function build(ctx: CompositeContext<ListProps>) {
		return ctx.list("items", ctx.props.items, {
			create: () => toy.create({ zIndex: ctx.prop("zIndex") }),
		});
	}

	it("keeps node identity per key and follows bound props", () => {
		const { graph, commit, frames } = manualGraph();
		const node = graph.root.add(listed.create({ items: ["a", "b", "c"] }));
		commit();
		const [a, b, c] = node.children;
		node.set("items", ["c", "a"]);
		commit();
		expect(node.children).toEqual([c, a]);
		expect(b?.disposed).toBe(true);
		node.set("zIndex", 4);
		commit();
		expect(frames.at(-1)?.frame.every((spec) => spec.zIndex === 4)).toBe(true);
	});

	it("reruns update when a context key it read changes", () => {
		const key = createContextKey("unit", 1);
		let seen: unknown[] = [];
		const reader = defineComposite<{ size?: number }>({
			name: "Reader",
			props: { size: { invalidates: Invalidate.UPDATE } },
			setup: (ctx) => {
				seen.push(ctx.context(key));
				return [];
			},
			update: (changed, ctx) => {
				if (changed.has(key)) seen.push(ctx.context(key));
				return undefined;
			},
		});
		const { graph, commit } = manualGraph();
		graph.root.add(reader.create({}));
		commit();
		graph.root.provide(key, 2);
		commit();
		expect(seen).toEqual([1, 2]);
		seen = [];
	});

	it("reruns update on ctx.invalidate, within the same commit when a descendant asks", () => {
		const reports = createContextKey<(value: number) => void>(
			"report",
			() => {},
		);
		const totals: number[] = [];
		const reporter = defineComposite<{ value: number }>({
			name: "Reporter",
			props: { value: { default: 0, invalidates: Invalidate.UPDATE } },
			setup: (ctx) => {
				ctx.context(reports)(ctx.props.value);
				return [];
			},
			update: (_changed, ctx) => {
				ctx.context(reports)(ctx.props.value);
				return undefined;
			},
		});
		const reason = createContextKey("reason", 0);
		const holder: { child: ReturnType<typeof reporter.create> | null } = {
			child: null,
		};
		const parent = defineComposite<object>({
			name: "Collector",
			props: {},
			setup: (ctx) => {
				let total = 0;
				ctx.provide(reports, (value) => {
					total = value;
					ctx.invalidate(reason);
				});
				ctx.onDispose(() => totals.push(-1));
				holder.child = reporter.create({ value: 3 });
				Object.defineProperty(ctx, "total", { get: () => total });
				return [holder.child];
			},
			update: (changed, ctx) => {
				expect(changed.has(reason)).toBe(true);
				totals.push((ctx as unknown as { total: number }).total);
				return undefined;
			},
		});
		const { graph, commit } = manualGraph();
		graph.root.add(parent.create({}));
		commit();
		expect(totals).toEqual([3]);
		holder.child?.set("value", 5);
		commit();
		expect(totals).toEqual([3, 5]);
	});
});
