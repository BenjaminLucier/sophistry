/**
 * The node kind behind the label definitions that lay out several text nodes
 * from measured text (`decimalNumber`, `variable`, `paragraph`, `title`): a
 * container whose one stage, `UPDATE`, rebuilds its children from its props
 * through last-input caches, and whose handle is its own measured box rather
 * than the union of its children's.
 *
 * It is a composite in all but name. It is not made with `defineComposite`
 * because these layouts also depend on the enclosing space (the groups'
 * scale is folded into the font they measure with), and their
 * handles report boxes the children do not cover (a paragraph as wide as its
 * measure, a number's reserved columns).
 *
 * Every prop invalidates `Invalidate.UPDATE`; the layout's caches decide how much
 * actually reruns. The theme and a web font load (`fontEpochContext`) rerun it
 * too, and joining a graph starts that graph's font-load subscription.
 */

import type { Bounds, Polyline } from "../geometry";
import { BaseContainer } from "../scene/container";
import { Invalidate, themeContext } from "../scene/context";
import { fontEpochContext, watchFontLoads } from "../scene/fonts";
import type { SceneGraph } from "../scene/graph";
import { ANY_CONTEXT, BaseNode } from "../scene/node";
import type { ContextKey, InvalidateBits, SceneNode } from "../scene/types";
import { SpaceChange } from "../scene/types";

/**
 * A box's four corners, `minX..maxX` by `minY..maxY`, as one closed polyline.
 *
 * @param minX - Left edge.
 * @param minY - Bottom edge.
 * @param maxX - Right edge.
 * @param maxY - Top edge.
 * @returns The corners, counter-clockwise from the bottom left.
 */
export function boxPolyline(
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
): Polyline {
	return [
		{ x: minX, y: minY },
		{ x: maxX, y: minY },
		{ x: maxX, y: maxY },
		{ x: minX, y: maxY },
	];
}

/**
 * Where a run's left edge sits relative to its anchor, for an alignment.
 *
 * @param width - The run's width.
 * @param align - The alignment of the run on its anchor.
 * @returns The left edge's offset from the anchor.
 */
export function leftEdgeOf(width: number, align: CanvasTextAlign): number {
	if (align === "left" || align === "start") return 0;
	if (align === "right" || align === "end") return -width;
	return -width / 2;
}

/**
 * A container that lays its children out from measured text.
 *
 * @typeParam P - The node's props.
 *
 * @category Text & numbers
 */
export abstract class TextLayoutNode<
	P extends object = object,
> extends BaseContainer<P> {
	/**
	 * Which `SpaceChange` fields rerun the layout. Default: the matrix and
	 * opacity, which the measuring font and the children's style fold in.
	 */
	protected readonly spaceFields: number =
		SpaceChange.MATRIX | SpaceChange.OPACITY;

	/**
	 * Rebuilds the children from the current props, space and context. Keep
	 * returning the same nodes (and the same array while they are unchanged):
	 * the children are reconciled by identity.
	 *
	 * @param dirty - The pending stage bits: always `UPDATE`, plus whatever
	 *   else the props, space or context that changed asked for (a subclass
	 *   may use `GEOMETRY` to mark what needs re-measuring).
	 */
	protected abstract layout(dirty: InvalidateBits): readonly SceneNode[];

	protected override run(dirty: InvalidateBits): void {
		if (dirty & Invalidate.UPDATE) this.setChildren(this.layout(dirty));
	}

	protected override stagesForSpace(change: number): InvalidateBits {
		return change & this.spaceFields ? Invalidate.UPDATE : 0;
	}

	protected override stagesForContext(
		key: ContextKey<unknown>,
	): InvalidateBits {
		// The theme gives the default font; a font load changes what it measures.
		return key === themeContext ||
			key === fontEpochContext ||
			key === ANY_CONTEXT
			? Invalidate.UPDATE | Invalidate.GEOMETRY
			: 0;
	}

	/** Joining a graph starts its font-load subscription (once per graph). */
	override attach(graph: SceneGraph): void {
		super.attach(graph);
		if (!graph.fontWatch) watchFontLoads(graph);
	}

	/* ----------------------------------------------------------- handles */

	/**
	 * The measured box (`localOutline` placed by `localMatrix`), not the union
	 * of the children's boxes.
	 */
	override bounds(): Bounds | null {
		return BaseNode.prototype.bounds.call(this);
	}

	override localBounds(): Bounds | null {
		return BaseNode.prototype.localBounds.call(this);
	}
}
