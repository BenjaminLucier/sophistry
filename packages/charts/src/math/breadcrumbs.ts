/**
 * Breadcrumbs for a drill-down: the trail of names from a hierarchy's root
 * to the focused node, laid out left to right, with text widths from a
 * `measure` callback. A trail may be a `{ from, to, t }` transition: shared
 * crumbs stay put, others fade with their end's weight, so it scrubs.
 */

import { clamp01 } from "@sophistry/core/internal";

/**
 * A focus path (names below the root: `[]` is the root, `["src", "lib"]`
 * is "lib" inside "src"), or a scrubbable `{ from, to, t }` transition
 * between two, either end possibly itself a transition. What
 * {@link useDrillDown} produces and both a hierarchy chart's `focus` and
 * {@link Breadcrumbs} take.
 *
 * @category Charts
 */
export type HierarchyPathSpec =
	| readonly string[]
	| {
			from: HierarchyPathSpec;
			to: HierarchyPathSpec;
			t: number;
	  };

/** Whether a path spec is a transition rather than a plain path. */
export function isPathTransition(
	spec: HierarchyPathSpec,
): spec is Exclude<HierarchyPathSpec, readonly string[]> {
	return !Array.isArray(spec);
}

/**
 * One path of a (possibly nested) transition with its share of the blend.
 *
 * @category Math & helpers
 */
export interface WeightedPath {
	path: readonly string[];
	/** 0..1; the weights of one spec sum to 1. */
	weight: number;
}

/** Whether two paths name the same node. */
export function samePath(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((name, i) => name === b[i]);
}

/**
 * A path spec as the paths it blends, each with its weight (equal paths
 * merged, zero weights dropped, in first-seen order).
 *
 * @category Math & helpers
 */
export function flattenPathSpec(spec: HierarchyPathSpec): WeightedPath[] {
	const out: WeightedPath[] = [];
	const visit = (s: HierarchyPathSpec, scale: number) => {
		if (!(scale > 0)) return;
		if (!isPathTransition(s)) {
			const same = out.find((w) => samePath(w.path, s));
			if (same) same.weight += scale;
			else out.push({ path: s, weight: scale });
			return;
		}
		const t = clamp01(s.t);
		visit(s.from, scale * (1 - t));
		visit(s.to, scale * t);
	};
	visit(spec, 1);
	return out;
}

/**
 * Where a path spec is heading: `to`'s path (recursively), or the plain path.
 *
 * @category Math & helpers
 */
export function pathTarget(spec: HierarchyPathSpec): readonly string[] {
	return isPathTransition(spec) ? pathTarget(spec.to) : spec;
}

/**
 * One crumb of a laid-out trail. Offsets are from the trail's anchor, in
 * the unit `measure` returned.
 *
 * @category Math & helpers
 */
export interface BreadcrumbItem {
	/** Stable identity: the crumb's path, JSON-encoded (`"…"` for the ellipsis). */
	key: string;
	/** The crumb's own path below the root (`[]` for the root crumb); for the ellipsis, the deepest crumb it hides. */
	path: string[];
	/** The text shown (the root's name for the root crumb). */
	name: string;
	/** 0 for the root crumb, +1 per level (the ellipsis is 1). */
	depth: number;
	/** Left edge of the crumb's text. */
	x: number;
	/** Width of the crumb's text. */
	width: number;
	/** Centre of the separator drawn before this crumb (unused at depth 0). */
	separatorX: number;
	/** Presence, 0..1: the summed weight of the paths that show it. */
	weight: number;
	/** How much this crumb is the focused (last) one, 0..1, as a fraction of its own weight. */
	current: number;
	/** Whether this is the ellipsis standing for the crumbs collapsed out of the middle. */
	ellipsis?: boolean;
	/** For the ellipsis: the names it stands for, root side first (of its heaviest path). */
	hidden?: string[];
}

/**
 * The trail's "back" control, laid out before the root crumb.
 *
 * @category Math & helpers
 */
export interface BreadcrumbBack {
	/** Left edge of the control. */
	x: number;
	/** Its width, as given. */
	width: number;
	/** Presence, 0..1: the weight of the paths below the root (none at the root). */
	weight: number;
	/** Where it goes: the parent of the path the spec is heading for; null when heading for the root. */
	path: string[] | null;
}

/** @category Math */
export interface BreadcrumbLayoutOptions {
	/** The root crumb's text. */
	root: string;
	/** Width of a crumb's text. */
	measure: (text: string) => number;
	/** Width of the separator's text. */
	separatorWidth: number;
	/** Space each side of a separator. */
	gap: number;
	/** Where the anchor is on the trail. @default "left" */
	align?: "left" | "center" | "right";
	/**
	 * The widest a trail may be, back control included. Wider paths keep the
	 * root and as many last crumbs as fit, collapsing the rest into one
	 * ellipsis; root, ellipsis and last crumb always show. Omitted, never collapses.
	 */
	maxWidth?: number;
	/** The ellipsis's text. @default "…" */
	ellipsis?: string;
	/** Reserve room for a back control this wide before the root crumb (plus `2 × gap`). Omitted, none. */
	backWidth?: number;
}

/** A crumb being accumulated across the weighted paths of a spec. */
interface Draft extends BreadcrumbItem {
	/** Weighted sum of the x it has on each path. */
	sumX: number;
	/** Whether its x differs between paths (only when some path collapses). */
	moves: boolean;
	/** The weight of the heaviest path seen showing it (for the ellipsis's target). */
	heaviest: number;
}

/**
 * Lays out a path spec's crumbs: one per distinct prefix of every blended
 * path, each placed after those before it on its own path. With
 * `maxWidth`, paths too wide collapse their middle into an ellipsis whose
 * `path` is the deepest crumb it hides.
 *
 * @category Math & helpers
 */
export function breadcrumbLayout(
	spec: HierarchyPathSpec,
	options: BreadcrumbLayoutOptions,
): { items: BreadcrumbItem[]; width: number; back?: BreadcrumbBack } {
	const terms = flattenPathSpec(spec);
	const items = new Map<string, Draft>();
	const step = options.separatorWidth + 2 * options.gap;
	const lead =
		options.backWidth === undefined
			? 0
			: Math.max(0, options.backWidth) + 2 * options.gap;
	const ellipsis = options.ellipsis ?? "…";
	const ellipsisWidth = options.measure(ellipsis);
	let width = 0;
	const add = (
		key: string,
		make: () => BreadcrumbItem,
		x: number,
		weight: number,
		last: boolean,
	) => {
		const item = items.get(key);
		if (item) {
			if (x !== item.x) item.moves = true;
			item.weight += weight;
			item.sumX += weight * x;
			if (last) item.current += weight;
			return item;
		}
		const draft: Draft = {
			...make(),
			x,
			weight,
			current: last ? weight : 0,
			sumX: weight * x,
			moves: false,
			heaviest: 0,
		};
		items.set(key, draft);
		return draft;
	};
	for (const { path, weight } of terms) {
		const names = [options.root, ...path];
		const widths = names.map((name) => options.measure(name));
		const n = path.length;
		// The first depth shown after the ellipsis; 0 when nothing collapses.
		let resume = 0;
		if (options.maxWidth !== undefined && n >= 2) {
			const full = lead + widths.reduce((sum, w) => sum + w, 0) + n * step;
			if (full > options.maxWidth) {
				// Root, ellipsis, then crumbs `resume..n`.
				let tail = widths[n];
				resume = n;
				for (let k = n - 1; k >= 2; k--) {
					const next = tail + widths[k] + step;
					if (
						lead + widths[0] + 2 * step + ellipsisWidth + next >
						options.maxWidth
					)
						break;
					tail = next;
					resume = k;
				}
			}
		}
		let x = lead;
		for (let depth = 0; depth <= n; depth++) {
			if (resume > 0 && depth === 1) {
				const hidden = path.slice(0, resume - 1);
				const item = add(
					"…",
					() => ({
						key: "…",
						path: hidden,
						name: ellipsis,
						depth: 1,
						x,
						width: ellipsisWidth,
						separatorX: 0,
						weight: 0,
						current: 0,
						ellipsis: true,
						hidden,
					}),
					x,
					weight,
					false,
				);
				if (weight > item.heaviest) {
					item.heaviest = weight;
					item.path = hidden;
					item.hidden = hidden;
				}
				x += ellipsisWidth + step;
				depth = resume - 1;
				continue;
			}
			const prefix = path.slice(0, depth);
			const key = JSON.stringify(prefix);
			const last = depth === n;
			add(
				key,
				() => ({
					key,
					path: prefix,
					name: names[depth],
					depth,
					x,
					width: widths[depth],
					separatorX: 0,
					weight: 0,
					current: 0,
				}),
				x,
				weight,
				last,
			);
			x += widths[depth] + (last ? 0 : step);
		}
		width += weight * x;
	}
	const shift =
		options.align === "center"
			? -width / 2
			: options.align === "right"
				? -width
				: 0;
	const list = [...items.values()].map((draft): BreadcrumbItem => {
		const { sumX, moves, heaviest: _heaviest, ...item } = draft;
		const x = (moves && item.weight > 0 ? sumX / item.weight : item.x) + shift;
		return {
			...item,
			x,
			separatorX: x - step / 2,
			current: item.weight > 0 ? item.current / item.weight : 0,
		};
	});
	if (options.backWidth === undefined) return { items: list, width };
	const target = pathTarget(spec);
	const back: BreadcrumbBack = {
		x: shift,
		width: Math.max(0, options.backWidth),
		weight: terms.reduce(
			(sum, term) => sum + (term.path.length > 0 ? term.weight : 0),
			0,
		),
		path: target.length > 0 ? target.slice(0, -1) : null,
	};
	return { items: list, width, back };
}
