/**
 * Bitmap reuse between frames, for the two cases where repainting every node
 * is work the picture does not need.
 *
 * - **A still prefix.** The frame is z-sorted, and in a typical animated scene
 *   the nodes that change sit at the end of it (the thing being dragged, the
 *   highlighted point, the bars of a sort over a static grid). When the first
 *   changed index has stayed at or after `d` for two frames running, the specs
 *   before `d` are painted once into an offscreen layer and every later frame
 *   is that layer plus the specs from `d` on — the same pixels, since paint
 *   order is preserved. The layer is dropped the moment anything before `d`
 *   changes, or the view, size or theme does.
 * - **Camera motion over an expensive scene.** When only the view changed and
 *   the last full paint was expensive, the last sharp frame is drawn under the
 *   change of view instead of repainting every node: a pan or zoom stays at
 *   frame rate however many nodes there are. The picture is a magnified or
 *   shifted copy for the length of the gesture, so it is re-painted sharp
 *   whenever the copy would leave too much of the viewport uncovered or be
 *   scaled too far, and once the view has been still for a moment.
 *
 * Both need an offscreen canvas; where none can be made (Node, tests with a
 * mock context) this does nothing and every frame paints in full.
 */

import type { Matrix } from "../geometry/transform.js";
import { compose, invert } from "../geometry/transform.js";
import type { DrawSpec } from "../spec/types.js";

/** A canvas this module can draw into and then draw from. */
export interface Surface {
	canvas: CanvasImageSource & { width: number; height: number };
	ctx: CanvasRenderingContext2D;
}

/** What one frame paints, and how. */
export interface LayerFrame {
	specs: readonly DrawSpec[];
	view: Matrix;
	width: number;
	height: number;
	/** Anything else the pixels depend on (theme, background): compared by identity. */
	key: readonly unknown[];
	/** Clears `ctx` to the frame's background, under the identity transform. */
	background(ctx: CanvasRenderingContext2D): void;
	/** Paints `specs[from, to)` into `ctx` under `view` (already installed). */
	draw(ctx: CanvasRenderingContext2D, from: number, to: number): void;
}

export interface LayerCacheOptions {
	/** Makes an offscreen surface, or null where there is none. */
	surface(width: number, height: number): Surface | null;
	/** Asks for one more paint, after the view has been still for `settleMs`. */
	repaint(): void;
	now?: () => number;
}

export interface LayerCache {
	/**
	 * Paints `frame` into `ctx` (which it clears first), reusing bitmaps where
	 * it can. Returns `"blit"` when the frame is a moved copy of an earlier one.
	 */
	paint(ctx: CanvasRenderingContext2D, frame: LayerFrame): "full" | "blit";
	/** Forgets every bitmap: the next frame paints in full. */
	reset(): void;
}

/** A prefix shorter than this is not worth a layer: painting it is cheap. */
const MIN_PREFIX = 32;
/** A full paint slower than this (ms) makes camera motion use the moved copy. */
const MOTION_BUDGET_MS = 6;
/** A frame with at least this many items is treated as expensive whatever its last timing. */
const MOTION_ITEMS = 4000;
/** How long the view must be still before a moved copy is re-painted sharp. */
const SETTLE_MS = 120;
/** A moved copy may leave at most this fraction of the viewport uncovered. */
const MAX_EXPOSED = 0.12;
/** …and be scaled by at most this factor either way. */
const MAX_SCALE = 1.5;

function sameMatrix(a: Matrix, b: Matrix): boolean {
	return (
		a.a === b.a &&
		a.b === b.b &&
		a.c === b.c &&
		a.d === b.d &&
		a.e === b.e &&
		a.f === b.f
	);
}

function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
	return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** The first index at which the two frames differ; `next.length` when `next` equals `previous`. */
function firstDifference(
	previous: readonly DrawSpec[] | null,
	next: readonly DrawSpec[],
): number {
	if (!previous) return 0;
	const shared = Math.min(previous.length, next.length);
	for (let i = 0; i < shared; i++) if (previous[i] !== next[i]) return i;
	return previous.length === next.length ? next.length : shared;
}

/** How many items a frame paints: a marks node counts as its items. */
function itemCount(specs: readonly DrawSpec[]): number {
	let count = specs.length;
	for (const spec of specs) if (spec.kind === "marks") count += spec.count;
	return count;
}

/**
 * Whether the old frame drawn under `t` (old device pixels → new) still makes
 * a fair picture of the new one: no rotation or flip, not scaled too far, and
 * covering nearly all of the viewport.
 */
function usableMove(t: Matrix, width: number, height: number): boolean {
	if (Math.abs(t.b) > 1e-9 || Math.abs(t.c) > 1e-9) return false;
	if (!(t.a > 0 && t.d > 0)) return false;
	if (t.a > MAX_SCALE || t.a < 1 / MAX_SCALE) return false;
	if (t.d > MAX_SCALE || t.d < 1 / MAX_SCALE) return false;
	const left = Math.max(0, t.e);
	const right = Math.min(width, t.e + t.a * width);
	const top = Math.max(0, t.f);
	const bottom = Math.min(height, t.f + t.d * height);
	const covered = Math.max(0, right - left) * Math.max(0, bottom - top);
	return 1 - covered / (width * height) <= MAX_EXPOSED;
}

/**
 * Creates the per-renderer bitmap cache. See the module comment for what it
 * reuses and when.
 */
export function createLayerCache(options: LayerCacheOptions): LayerCache {
	const now =
		options.now ??
		(() =>
			typeof performance !== "undefined" ? performance.now() : Date.now());

	/** The specs, view and key of the last frame painted in full. */
	let last: {
		specs: readonly DrawSpec[];
		view: Matrix;
		width: number;
		height: number;
		key: readonly unknown[];
	} | null = null;
	/** How long that paint took, and how many items it had. */
	let lastCost = 0;
	let lastItems = 0;
	/** The first changed index of the previous frame, for the two-frame rule. */
	let previousChange = -1;

	let prefix: { surface: Surface; count: number } | null = null;
	let spare: Surface | null = null;
	let motion: { surface: Surface; view: Matrix } | null = null;
	let settle: ReturnType<typeof setTimeout> | null = null;
	/** The next paint must be sharp (the first, the settle repaint, or after a reset). */
	let forceFull = true;

	const surfaceOf = (
		held: Surface | null,
		width: number,
		height: number,
	): Surface | null => {
		if (held && held.canvas.width === width && held.canvas.height === height)
			return held;
		return options.surface(width, height);
	};

	const reset = () => {
		last = null;
		prefix = null;
		motion = null;
		previousChange = -1;
		forceFull = true;
		if (settle !== null) clearTimeout(settle);
		settle = null;
	};

	const scheduleSettle = () => {
		if (settle !== null) clearTimeout(settle);
		settle = setTimeout(() => {
			settle = null;
			forceFull = true;
			options.repaint();
		}, SETTLE_MS);
	};

	const paint = (
		ctx: CanvasRenderingContext2D,
		frame: LayerFrame,
	): "full" | "blit" => {
		const { specs, view, width, height } = frame;
		const sameFrame =
			last !== null &&
			last.width === width &&
			last.height === height &&
			sameKey(last.key, frame.key);
		if (!sameFrame) {
			prefix = null;
			motion = null;
			previousChange = -1;
		}
		const change = sameFrame ? firstDifference(last?.specs ?? null, specs) : 0;
		const viewSame = sameFrame && last !== null && sameMatrix(last.view, view);

		// Only the camera moved, over a scene that is slow to paint: draw the
		// last sharp frame under the change of view.
		const full = forceFull;
		forceFull = false;
		if (
			!full &&
			sameFrame &&
			!viewSame &&
			change === specs.length &&
			motion &&
			(lastCost > MOTION_BUDGET_MS || lastItems >= MOTION_ITEMS)
		) {
			const t = compose(view, invert(motion.view));
			if (usableMove(t, width, height)) {
				frame.background(ctx);
				ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
				ctx.drawImage(motion.surface.canvas, 0, 0);
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				scheduleSettle();
				return "blit";
			}
		}

		const started = now();
		if (!viewSame || (prefix && change < prefix.count)) prefix = null;

		// The two-frame rule: a prefix is cached once the first change has
		// stayed at or after the same index twice running, so a frame that
		// happens to start its changes late does not pay for a layer it will
		// throw away next frame.
		const stable =
			viewSame &&
			change >= MIN_PREFIX &&
			change < specs.length &&
			previousChange >= 0 &&
			change >= previousChange;
		previousChange = viewSame ? change : -1;
		if (!prefix && stable) {
			const surface = surfaceOf(spare, width, height);
			if (surface) {
				const layer = surface.ctx;
				layer.setTransform(1, 0, 0, 1, 0, 0);
				frame.background(layer);
				layer.setTransform(view.a, view.b, view.c, view.d, view.e, view.f);
				frame.draw(layer, 0, change);
				layer.setTransform(1, 0, 0, 1, 0, 0);
				prefix = { surface, count: change };
				spare = surface;
			}
		}

		let from = 0;
		if (prefix) {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, width, height);
			ctx.drawImage(prefix.surface.canvas, 0, 0);
			from = prefix.count;
		} else {
			frame.background(ctx);
		}
		ctx.setTransform(view.a, view.b, view.c, view.d, view.e, view.f);
		frame.draw(ctx, from, specs.length);
		ctx.setTransform(1, 0, 0, 1, 0, 0);

		// A full paint of the whole frame is what a later camera move may copy.
		// Keeping a copy costs one blit, so only an expensive scene keeps one,
		// and only from a frame that starts or ends a camera move (only the view
		// changed, or the settle repaint): a frame whose nodes changed is not
		// one the next camera frame could reuse.
		if (from === 0) {
			lastCost = now() - started;
			lastItems = itemCount(specs);
		}
		const expensive = lastCost > MOTION_BUDGET_MS || lastItems >= MOTION_ITEMS;
		const cameraFrame = (sameFrame && change === specs.length) || full;
		if (!expensive) {
			motion = null;
		} else if (cameraFrame) {
			const held = motion?.surface ?? null;
			const surface = surfaceOf(held, width, height);
			if (surface) {
				surface.ctx.setTransform(1, 0, 0, 1, 0, 0);
				surface.ctx.clearRect(0, 0, width, height);
				surface.ctx.drawImage(
					(ctx.canvas ?? null) as unknown as CanvasImageSource,
					0,
					0,
				);
				motion = { surface, view };
			}
		} else {
			// The nodes changed: an older copy no longer shows them.
			motion = null;
		}

		last = { specs, view, width, height, key: frame.key };
		return "full";
	};

	return { paint, reset };
}
