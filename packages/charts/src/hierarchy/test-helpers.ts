/**
 * Readers for the hierarchy family's tests: the batched items of a mounted
 * chart as boxes, its labels, and its nodes' interaction (the shared props
 * of its batched node, tapped and hovered by item the way the pointer
 * driver and the accessibility layer deliver them). Not exported.
 */

import type { SceneNode } from "@sophistry/core";
import { group, type InteractionHandlers } from "@sophistry/core";
import { parseColor, toCss } from "@sophistry/core/color";
import type { Bounds } from "@sophistry/core/geometry";
import type { MarksSpec, TextSpec } from "@sophistry/core/internal";
import type { MarkItem } from "../test-harness.js";
import { markItems, mount } from "../test-harness.js";
import type { TooltipState } from "../tooltip.js";
import { createTooltipState, tooltipContext } from "../tooltip.js";

export type Scene = ReturnType<typeof mount>;

/** A batched item's box in scene units. */
export function boxOfItem(item: MarkItem): Bounds {
	if (item.polylines.length > 0) {
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const line of item.polylines)
			for (const p of line) {
				minX = Math.min(minX, p.x);
				minY = Math.min(minY, p.y);
				maxX = Math.max(maxX, p.x);
				maxY = Math.max(maxY, p.y);
			}
		return { minX, minY, maxX, maxY };
	}
	return {
		minX: item.center.x - item.halfWidth,
		maxX: item.center.x + item.halfWidth,
		minY: item.center.y - item.halfHeight,
		maxY: item.center.y + item.halfHeight,
	};
}

/**
 * Every batched item drawn, in spec order, with its spec. `alpha` is the
 * item's whole opacity: its own times the layer's shared one (a layer whose
 * items all share an opacity carries it in its style). `reveal` is its own
 * arc-length reveal (a shape's `progress`; 1 when the spec has none).
 */
export function items(
	scene: Scene,
): (MarkItem & { spec: MarksSpec; reveal: number })[] {
	return scene.marks().flatMap((spec) =>
		markItems(spec).map((item, i) => ({
			...item,
			alpha: item.alpha * spec.style.opacity,
			reveal: spec.progresses ? (spec.progresses[i] as number) : 1,
			spec,
		})),
	);
}

/** Items of the marks specs whose shape is `kind`. */
export function itemsOf(
	scene: Scene,
	kind: MarksSpec["shape"]["kind"],
): (MarkItem & { spec: MarksSpec; reveal: number })[] {
	return items(scene).filter((item) => item.spec.shape.kind === kind);
}

/** Drawn items (alpha above 0). */
export function drawn(scene: Scene) {
	return items(scene).filter((item) => item.alpha > 0);
}

/** Drawn items' boxes. */
export function boxes(scene: Scene): Bounds[] {
	return drawn(scene).map(boxOfItem);
}

/** A box's area. */
export function area(box: Bounds): number {
	return (box.maxX - box.minX) * (box.maxY - box.minY);
}

/** Text specs drawn. */
export function labels(scene: Scene): TextSpec[] {
	return scene.texts();
}

/** The strings drawn. */
export function texts(scene: Scene): string[] {
	return scene.texts().map((spec) => spec.text);
}

/** The label drawn with `text`. */
export function labelOf(scene: Scene, text: string): TextSpec {
	const found = labels(scene).find((spec) => spec.text === text);
	if (!found)
		throw new Error(`no label ${text}: ${JSON.stringify(texts(scene))}`);
	return found;
}

/** Every node below `root`, depth first. */
export function descendants(root: SceneNode): SceneNode[] {
	const out: SceneNode[] = [];
	const visit = (node: SceneNode) => {
		out.push(node);
		const children = (node as { children?: readonly SceneNode[] }).children;
		if (children) for (const child of children) visit(child);
	};
	visit(root);
	return out;
}

/** The shared interaction props of `chart`'s batched node(s) that carry handlers. */
export function batchHandlers(chart: SceneNode): InteractionHandlers & {
	label?: string;
	cursor?: string;
} {
	for (const node of descendants(chart)) {
		if (node.type !== "Instances" && node.type !== "PathBatch") continue;
		const props = (
			node.type === "Instances"
				? (node as SceneNode<{ shared?: object }>).get("shared")
				: node
		) as Record<string, unknown> | undefined;
		const read = (key: string) =>
			node.type === "Instances"
				? props?.[key]
				: (node as SceneNode<Record<string, unknown>>).get(key);
		if (read("onTap") || read("itemLabel") || read("onEnter"))
			return {
				label: read("label") as string | undefined,
				cursor: read("cursor") as string | undefined,
				itemLabel: read("itemLabel") as InteractionHandlers["itemLabel"],
				onTap: read("onTap") as InteractionHandlers["onTap"],
				onEnter: read("onEnter") as InteractionHandlers["onEnter"],
				onLeave: read("onLeave") as InteractionHandlers["onLeave"],
				keyboard: read("keyboard") as InteractionHandlers["keyboard"],
			};
	}
	return {};
}

/** The accessible names of `chart`'s batched items, in item order. */
export function itemNames(chart: SceneNode, scene: Scene): string[] {
	const handlers = batchHandlers(chart);
	if (!handlers.itemLabel) return [];
	const count = scene.marks().reduce((n, spec) => Math.max(n, spec.count), 0);
	const out: string[] = [];
	for (let i = 0; i < count; i++) {
		const name = handlers.itemLabel(i);
		if (name !== undefined) out.push(name);
	}
	return out;
}

/** The item of `chart`'s batched node whose accessible name is `name`. */
export function itemNamed(
	chart: SceneNode,
	scene: Scene,
	name: string,
): number {
	const handlers = batchHandlers(chart);
	const count = scene.marks().reduce((n, spec) => Math.max(n, spec.count), 0);
	for (let i = 0; i < count; i++)
		if (handlers.itemLabel?.(i) === name) return i;
	throw new Error(
		`no item named ${name}: ${JSON.stringify(itemNames(chart, scene))}`,
	);
}

/** A pointer event on one item, as the driver hands it over. */
export function itemEvent(item: number, mouse = false) {
	return { item, pointerId: mouse ? 1 : -1, native: undefined } as never;
}

/**
 * Mounts `chart` inside a group providing a tooltip state the test can read,
 * with helpers to tap and hover its items by accessible name.
 */
export function mountChart(chart: SceneNode) {
	const tooltip: TooltipState = createTooltipState();
	const host = group.create({});
	host.provide(tooltipContext, tooltip);
	host.add(chart);
	const scene = mount(host);
	return {
		scene,
		tooltip,
		/** The text the tooltip shows, or null. */
		tip: () => tooltip.active.peek()?.text ?? null,
		names: () => itemNames(chart, scene),
		handlers: () => batchHandlers(chart),
		tap(name: string) {
			const item = itemNamed(chart, scene, name);
			const onTap = batchHandlers(chart).onTap;
			if (!onTap) throw new Error(`${name} has no tap`);
			onTap(itemEvent(item));
			scene.commit();
		},
		hover(name: string) {
			const item = itemNamed(chart, scene, name);
			batchHandlers(chart).onEnter?.(itemEvent(item, true));
			scene.commit();
		},
		step(seconds: number) {
			scene.advance(seconds);
		},
	};
}

/** A keydown as the accessibility layer hands it to a node's `key`. */
export function press(key: string): KeyboardEvent {
	return { key, preventDefault: () => {} } as unknown as KeyboardEvent;
}

/** A colour with its alpha dropped, as CSS: compares a tinted group's fill with its branch colour. */
export function opaque(color: string): string {
	return toCss({ ...parseColor(color), a: 1 });
}

/** A colour's alpha, 0..1. */
export function alphaOf(color: string): number {
	return parseColor(color).a;
}
