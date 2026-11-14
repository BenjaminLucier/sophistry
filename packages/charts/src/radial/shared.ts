/**
 * Helpers shared by the radial charts (pie, polar area, radar, radial bars,
 * gauge, chord, waffle): wedge outlines as path batch items, a per-key item
 * cache (so an unchanged wedge keeps its prepared outline), keyed label
 * lists, the far end's colour scale across a keyed transition, and the
 * standalone tooltip state. Internal to the family.
 */

import type {
	CompositeContext,
	PathBatchItem,
	SceneNode,
	TextNodeProps,
} from "@sophistry/core";
import { frameContext, pointerContext, text } from "@sophistry/core";
import type { BandKey } from "@sophistry/core/geometry";
import {
	annularSectorCurvePath,
	sectorCurvePath,
} from "@sophistry/core/geometry";
import type { Theme } from "@sophistry/core/themes";
import { tooltipOverlay } from "../frame/tooltip-overlay.js";
import type { OrdinalColorScale } from "../math/ordinal.js";
import { ordinalColorScale, uniqueKeys } from "../math/ordinal.js";
import type { Category } from "../series.js";
import type { TooltipState } from "../tooltip.js";
import { createTooltipState, tooltipContext } from "../tooltip.js";
import { shallowEqual } from "../util.js";

/** Smallest sweep worth drawing, in radians: what `sector` and `annularSector` skip. */
export const NO_SWEEP = 1e-9;

/** What a wedge's outline is made from. */
export interface WedgeShape {
	cx: number;
	cy: number;
	/** 0 for a plain pie slice (`sector`), else a ring slice (`annularSector`). */
	innerRadius: number;
	outerRadius: number;
	startAngle: number;
	/** Signed sweep, radians; positive is counter-clockwise. */
	angle: number;
}

/**
 * A wedge as a path batch item: the same native curve geometry `sector` (no
 * hole) or `annularSector` (a hole) build, so each item outlines exactly
 * what the per-datum shape does. Undefined when the sweep is too small
 * to draw (as those shapes draw nothing).
 *
 * @param annular - Draw a ring slice even when `innerRadius` is 0.
 */
export function wedgeItem(
	shape: WedgeShape,
	paints: Omit<PathBatchItem, "closed" | "polylines" | "curvePaths">,
	annular = false,
): PathBatchItem | undefined {
	if (!(Math.abs(shape.angle) > NO_SWEEP)) return undefined;
	const end = shape.startAngle + shape.angle;
	const curve =
		annular || shape.innerRadius > 0
			? annularSectorCurvePath(
					shape.cx,
					shape.cy,
					shape.innerRadius,
					shape.outerRadius,
					shape.startAngle,
					end,
				)
			: sectorCurvePath(
					shape.cx,
					shape.cy,
					shape.outerRadius,
					shape.startAngle,
					end,
				);
	return { curvePaths: [curve], closed: true, ...paints };
}

/**
 * A per-key cache of path batch items: hands back last update's item while
 * its inputs are equal (shallowly), so the batch reuses its prepared outline.
 * Call `sweep()` after an update to forget keys that were not asked for.
 */
export function createItemCache<I>(): {
	get(key: unknown, inputs: readonly unknown[], make: () => I): I;
	sweep(): void;
} {
	let last = new Map<unknown, { inputs: readonly unknown[]; item: I }>();
	let next = new Map<unknown, { inputs: readonly unknown[]; item: I }>();
	return {
		get(key, inputs, make) {
			const kept = last.get(key);
			const entry =
				kept && shallowEqual(kept.inputs, inputs)
					? kept
					: { inputs, item: make() };
			next.set(key, entry);
			return entry.item;
		},
		sweep() {
			last = next;
			next = new Map();
		},
	};
}

/** One label of a keyed list: its key and the label's props. */
export interface KeyedLabel {
	key: unknown;
	props: TextNodeProps;
}

/**
 * Keyed `text` nodes for one list (`slot`): a node per key, created once
 * and updated in place (equal values are no-ops on the node), disposed when
 * its key leaves.
 */
export function labelList<P>(
	ctx: CompositeContext<P>,
	slot: string,
	labels: readonly KeyedLabel[],
): SceneNode[] {
	return ctx.list(slot, labels, {
		key: (entry) => entry.key,
		create: (entry) => text.create(entry.props),
		update: (node, entry) => {
			node.update(entry.props);
		},
	});
}

/**
 * The colour scale `to`'s series colour through, across a keyed transition:
 * the chart's shared scale inside a chart (`own`), else one over `to`'s own
 * categories, as its plain chart has. Call once, in
 * `setup`.
 */
export function createFarScale(): (
	inChart: boolean,
	toOf: readonly Category[] | undefined,
	own: OrdinalColorScale,
	theme: Theme,
) => OrdinalColorScale {
	let last:
		| { domain: readonly BandKey[]; theme: Theme; scale: OrdinalColorScale }
		| undefined;
	return (inChart, toOf, own, theme) => {
		if (inChart) return own;
		const domain = uniqueKeys(toOf ?? []);
		if (last && last.theme === theme && shallowEqual(last.domain, domain))
			return last.scale;
		const scale = ordinalColorScale(domain, theme.palette.series);
		last = { domain, theme, scale };
		return scale;
	};
}

/**
 * The tooltip a standalone radial chart shows through: the enclosing
 * chart's, else its own. Call once,
 * in `setup`, and read the result in each `update`.
 *
 * Outside a chart the state is kept (handlers, accessible names, the item
 * walked by the keys) and `overlay(ctx)` returns the panel drawing it, a
 * {@link tooltipOverlay} bound to the scene's pointer and view: append it to the composite's children. Inside a
 * chart it returns nothing, the frame's overlay draws the tooltip.
 */
export function createOwnTooltip(): OwnTooltip {
	let own: TooltipState | undefined;
	let panel: SceneNode | undefined;
	const of = <P>(ctx: CompositeContext<P>): TooltipState => {
		const chart = ctx.context(tooltipContext);
		if (chart) return chart;
		own ??= createTooltipState();
		return own;
	};
	return Object.assign(of, {
		overlay<P>(ctx: CompositeContext<P>): SceneNode[] {
			if (ctx.context(tooltipContext)) return [];
			const state = of(ctx);
			const pointer = ctx.context(pointerContext);
			panel ??= tooltipOverlay.create({
				state,
				active: state.active,
				...(pointer ? { pointer } : {}),
				view: ctx.context(frameContext),
			} as never);
			return [panel];
		},
	});
}

/** What {@link createOwnTooltip} returns: the state, and its standalone panel. */
export interface OwnTooltip {
	<P>(ctx: CompositeContext<P>): TooltipState;
	/** The panel to append to the children outside a chart; empty inside one. */
	overlay<P>(ctx: CompositeContext<P>): SceneNode[];
}
