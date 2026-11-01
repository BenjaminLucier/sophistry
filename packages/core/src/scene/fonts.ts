/**
 * Re-measuring after a web font loads. Text measured before its font arrived
 * has the fallback font's box; once `document.fonts` reports the load, every
 * text node's handle box, every layout that measured text and the renderer's
 * cached pixels are stale.
 *
 * One `fontLoads` subscription per scene graph, started lazily by the first
 * text node to join it (or the first composite that measures): a scene with
 * no text never subscribes. On a load the graph root provides the new epoch
 * under {@link fontEpochContext}, which walks the tree once: text nodes map
 * the key to their geometry stage, and composites that read the key (with
 * {@link measuresText}) rerun their `update`. Then the graph's `onFontLoad`
 * (the scene's `renderer.invalidate()`) repaints from nothing. Between loads
 * none of this costs anything: nobody holds a per-node subscription and no
 * provided value changes.
 */

import { fontLoads } from "../spec/metrics.js";
import type { CompositeContext } from "./composite.js";
import { createContextKey } from "./context.js";
import type { SceneGraph } from "./graph.js";
import type { BaseNode } from "./node.js";
import type { ContextKey } from "./types.js";

/**
 * How many web fonts had finished loading when the scene last heard of one:
 * provided by the scene graph's root, and bumped on each load (see
 * `fontLoads`). Its value means nothing on its own; reading it is how a node
 * or composite that measured text asks to rerun when the measurements may
 * have changed. Text nodes map it to their geometry stage; a composite reads
 * it with {@link measuresText}.
 *
 * @category Text & numbers
 */
export const fontEpochContext: ContextKey<number> = createContextKey<number>(
	"fontEpoch",
	0,
);

/**
 * Starts `graph`'s font-load subscription, once (later calls return at once).
 * On each load the root provides the new epoch under
 * {@link fontEpochContext} and the graph's `onFontLoad` runs. The
 * subscription ends with the graph.
 *
 * @param graph - The scene graph that measures or draws text.
 * @category Text & numbers
 */
export function watchFontLoads(graph: SceneGraph): void {
	if (graph.fontWatch) return;
	graph.fontWatch = fontLoads.subscribe(() => {
		graph.root.provide(fontEpochContext, fontLoads.peek());
		graph.fontLoaded();
	});
}

/**
 * Declares that a composite lays out with measured text: its `update` reruns
 * (with {@link fontEpochContext} in `changed`) after a web font loads, so the
 * layout re-measures. Call it in `setup`, before measuring; it is one context
 * read, plus starting the scene's font-load subscription if nothing did yet.
 *
 * @example
 * ```ts
 * import {
 * 	type CompositeContext,
 * 	defineComposite,
 * 	label,
 * 	measuresText,
 * 	Invalidate,
 * 	wrapText,
 * } from "@sophistry/core";
 *
 * interface CaptionProps {
 * 	text: string;
 * }
 *
 * export const caption = defineComposite<CaptionProps>({
 * 	name: "Caption",
 * 	props: { text: { default: "", invalidates: Invalidate.UPDATE } },
 * 	setup: (ctx) => {
 * 		measuresText(ctx);
 * 		return layout(ctx);
 * 	},
 * 	// `changed` holds `fontEpochContext` after a font load.
 * 	update: (changed, ctx) => layout(ctx),
 * });
 *
 * // One label per line, wrapped with the current font's measured widths.
 * function layout(ctx: CompositeContext<CaptionProps>) {
 * 	const style = { fontSize: 0.4, fontFamily: "sans-serif", fontWeight: 400, italic: false, letterSpacing: 0 };
 * 	return wrapText(ctx.props.text, style, 4).map((line, index) =>
 * 		label.create({ text: line, y: -0.5 * index, fontSize: 0.4 }),
 * 	);
 * }
 * ```
 *
 * @param ctx - The composite's context.
 * @returns The current font epoch.
 * @category Text & numbers
 */
export function measuresText<P>(ctx: CompositeContext<P>): number {
	const graph = (ctx.node as unknown as BaseNode).graph;
	if (graph) watchFontLoads(graph);
	return ctx.context(fontEpochContext);
}
