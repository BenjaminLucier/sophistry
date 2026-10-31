/**
 * `prefers-reduced-motion` as a Readable. A mode is `"auto"` (follow the OS,
 * live), `"reduce"` or `"no-preference"`; clocks carry one, a scene can
 * override it, and runners jump to the end state when it is on. The media
 * query is read lazily, on the first `peek` or `subscribe`, and only where
 * `matchMedia` exists; elsewhere (server rendering, plain Node) the preference
 * reads as no preference.
 */

import type { Readable } from "../reactive";
import { track } from "../reactive";

/**
 * How a clock, scene or run decides whether to reduce motion.
 *
 * - `"auto"`: follow the user's `prefers-reduced-motion` setting, live.
 * - `"reduce"`: always reduce.
 * - `"no-preference"`: never reduce (motion plays regardless of the setting).
 *
 * @category Tracks & clocks
 */
export type ReducedMotion = "auto" | "reduce" | "no-preference";

const QUERY = "(prefers-reduced-motion: reduce)";

const system = track(false);
let watching: unknown = null;
let unwatch: (() => void) | null = null;

/** Starts (or re-points) the media-query listener; a no-op without `matchMedia`. */
function watchSystem(): void {
	const matchMedia =
		typeof window !== "undefined" && typeof window.matchMedia === "function"
			? window.matchMedia
			: null;
	if (matchMedia === watching) return;
	unwatch?.();
	unwatch = null;
	watching = matchMedia;
	if (!matchMedia) return;
	const query = window.matchMedia(QUERY);
	system.set(query.matches);
	const onChange = (event: { matches: boolean }) => system.set(event.matches);
	query.addEventListener?.("change", onChange);
	unwatch = () => query.removeEventListener?.("change", onChange);
}

/**
 * Whether the user has asked the system to reduce motion, as a Readable that
 * follows changes to the setting. Always `false` where there is no
 * `matchMedia` (server rendering, plain Node).
 *
 * @example
 * ```ts
 * import { createScene, fadeIn, prefersReducedMotion, track } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.querySelector("#figure")! });
 * const opacity = track(0);
 * if (prefersReducedMotion.peek()) opacity.set(1); // skip the intro
 * else await scene.play(fadeIn(opacity));
 * ```
 *
 * @category Tracks & clocks
 */
export const prefersReducedMotion: Readable<boolean> = {
	peek() {
		watchSystem();
		return system.peek();
	},
	subscribe(onStale) {
		watchSystem();
		return system.subscribe(onStale);
	},
};

/**
 * Resolves a {@link ReducedMotion} mode to a boolean, now. `"auto"` reads
 * {@link prefersReducedMotion}.
 *
 * @param mode - The mode to resolve.
 * @returns Whether motion should be reduced.
 *
 * @category Tracks & clocks
 */
export function resolveReducedMotion(mode: ReducedMotion): boolean {
	if (mode === "reduce") return true;
	if (mode === "no-preference") return false;
	return prefersReducedMotion.peek();
}

/** Forgets the media query and the last-seen value. For tests only. */
export function resetReducedMotion(): void {
	unwatch?.();
	unwatch = null;
	watching = null;
	system.set(false);
}
