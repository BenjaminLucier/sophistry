/**
 * Invalidation bits and context keys: the two vocabularies a node's cached pipeline
 * and its surroundings are described in.
 */

import type { Bounds } from "../geometry";
import type { ScenePointer } from "../interact/pointer";
import type { Readable } from "../reactive";
import { track } from "../reactive";
import { resolveTheme } from "../themes/theme";
import type { Theme } from "../themes/types";
import type { Clock } from "../tween/clock";
import { defaultClock } from "../tween/clock";
import type { ContextKey } from "./types";

/**
 * The stage bits a prop write can invalidate. A node kind decides what each
 * bit reruns; these are the names the built-in kinds share, so descriptors
 * read the same everywhere.
 *
 * For a shape (see `scene/shape.ts`):
 *
 * - `GEOMETRY`: the outline (the definition's `geometry`), then style if it
 *   paints a box gradient, then the spec.
 * - `STYLE`: the base stroke style (paints, widths, dashes, opacity), then the spec.
 * - `TRANSFORM`: where the node sits (offset, local TRS); the spec reassembles
 *   from its last-input caches, so the outline keeps its identity.
 * - `SPEC`: only the spec assembly (`progress`, `zIndex`, `visible`, `write`).
 * - `INTERACTION`: the node's interaction record (handlers, hit area, focus).
 *
 * For containers: `SPACE` recomputes the space handed to the children;
 * `UPDATE` reruns a composite's `update`.
 *
 * @category Scene graph
 */
export const Invalidate = {
	NONE: 0,
	GEOMETRY: 1,
	STYLE: 2,
	TRANSFORM: 4,
	SPEC: 8,
	SPACE: 16,
	INTERACTION: 32,
	UPDATE: 64,
	/** Every bit: what a new node starts with. */
	ALL: 127,
} as const;

/**
 * Makes a context key. Containers `provide(key, value)`; any descendant reads
 * the nearest value with `node.context(key)` (composites with
 * `ctx.context(key)`, which also reruns their `update` when it changes).
 *
 * Values are looked up through the parent chain when read. A value that
 * changes often should be a `Readable` provided once (descendants bind to
 * it), rather than re-provided every frame: re-providing walks the subtree.
 *
 * @example
 * ```ts
 * import { createContextKey, createScene, group } from "@sophistry/core";
 *
 * const scales = createContextKey<{ x: (value: number) => number }>("scales", { x: (value) => value });
 * const scene = createScene({ host: document.body });
 * const chart = scene.add(group.create({}));
 * chart.provide(scales, { x: (value) => value * 2 });
 * // inside a descendant composite: ctx.context(scales).x(3)
 * ```
 *
 * @param name - For error messages.
 * @param defaultValue - What readers get with no provider above them.
 * @returns The key.
 * @category Scene graph
 */
export function createContextKey<T>(
	name: string,
	defaultValue: T,
): ContextKey<T>;
export function createContextKey<T>(name: string): ContextKey<T | undefined>;
export function createContextKey<T>(
	name: string,
	defaultValue?: T,
): ContextKey<T | undefined> {
	return Object.freeze({ name, defaultValue });
}

/**
 * The active theme. The scene root provides the scene's theme (following the
 * page's colour mode when the scene uses the default theme); a container may
 * provide another for its subtree. Shapes restyle when it changes.
 *
 * @category Scene graph
 */
export const themeContext: ContextKey<Theme> = Object.freeze({
	name: "theme",
	// Resolved when read, so importing the module touches no DOM.
	get defaultValue() {
		return resolveTheme();
	},
});

/**
 * The clock scene scripts run on: the scene's `clock` option, else
 * `defaultClock`. `scene.play(...)` uses it.
 *
 * @category Scene graph
 */
export const clockContext: ContextKey<Clock> = createContextKey<Clock>(
	"clock",
	defaultClock,
);

/**
 * Whether runs in this subtree reduce motion: the scene's `reducedMotion`
 * option, else its clock's setting.
 *
 * @category Scene graph
 */
export const reducedMotionContext: ContextKey<Readable<boolean>> =
	createContextKey<Readable<boolean>>(
		"reducedMotion",
		defaultClock.reducedMotion,
	);

/** Viewport of a default scene (16 units wide, 16/9), for nodes outside one. */
const DEFAULT_FRAME: Bounds = { minX: -8, minY: -4.5, maxX: 8, maxY: 4.5 };

/**
 * The visible box in scene units, as a `Readable` (what `toEdge`/`toCorner`
 * pin against). The scene provides one that follows its view and canvas
 * size; bind to it, so only the nodes that care pay for a pan.
 *
 * @category Scene graph
 */
export const frameContext: ContextKey<Readable<Bounds>> = createContextKey<
	Readable<Bounds>
>("frame", track(DEFAULT_FRAME));

/**
 * Where the pointer is over the scene's canvas (`scene.pointer`), for
 * composites that follow it (a chart's tooltip, a crosshair). Null outside a
 * scene (a hand-committed graph), and its value null while no pointer is
 * over the canvas. Bind to it rather than reading it in `update`.
 *
 * @category Scene graph
 */
export const pointerContext: ContextKey<Readable<ScenePointer | null> | null> =
	createContextKey<Readable<ScenePointer | null> | null>("pointer", null);
