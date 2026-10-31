/**
 * `Animatable<T>`: the minimal thing an animation drives, `peek()` plus `set()`.
 * A `Track` is one; `lensTarget`, `propTarget` and `storeTarget` adapt any
 * getter/setter pair, an object property or a value inside a plain object
 * tree.
 *
 * Every write is synchronous (a track notifies its subscribers at once and
 * the scene recomputes at the next commit), so `peek()` after `set()` always
 * reads the value just written; nothing needs remembering in between.
 */

/**
 * Anything an animation can write to: a {@link Track}, or a {@link lensTarget}
 * / {@link propTarget} / {@link storeTarget} built over your own state.
 *
 * `peek` reads the current value (animations use it to capture start
 * values); `set` writes one value. `set` receives the value itself, never an
 * updater, so a target whose `T` is a function is not ambiguous.
 *
 * @typeParam T - The value type.
 *
 * @category Tracks & clocks
 */
export interface Animatable<T> {
	/** Reads the current value. */
	peek(): T;
	/** Writes a value. */
	set(value: T): void;
}

/**
 * Builds an {@link Animatable} from a getter and a setter: the adapter for
 * state the other helpers do not cover (a framework store, a model with
 * setters). The getter must return what the setter last wrote, so the
 * animation can read back its own writes.
 *
 * @example
 * ```ts
 * import { createScene, lensTarget, valueTo } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.querySelector("#figure")! });
 * const audio = document.querySelector("audio")!;
 * const volume = lensTarget(() => audio.volume, (value) => { audio.volume = value; });
 * void scene.play(valueTo(volume, 0));
 * ```
 *
 * @param get - Reads the current value.
 * @param set - Writes a value.
 * @returns The target.
 * @category Tracks & clocks
 */
export function lensTarget<T>(
	get: () => T,
	set: (value: T) => void,
): Animatable<T> {
	return { peek: get, set };
}

/** A key of an object or index of an array, one step of a {@link storeTarget} path. */
export type PathKey = string | number;

/**
 * Animates one value inside a plain object tree, addressed by a key path.
 *
 * Reads and writes walk the path from `root` on every access, so parents may
 * be replaced between frames as long as the path exists when the animation
 * reads or writes it. The write is a plain assignment to the leaf: **not
 * reactive** (pair it with your own repaint, or use {@link lensTarget} to
 * also notify something).
 *
 * @example
 * ```ts
 * import { createScene, storeTarget, valueTo } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.querySelector("#figure")! });
 * const model = { points: [{ x: 0, y: 0 }] };
 * void scene.play(valueTo(storeTarget<number>(model, ["points", 0, "x"]), 3));
 * ```
 *
 * @param root - The object holding the value.
 * @param path - Keys from `root` to the animated value, e.g. `["points", 3, "x"]`.
 *   The leaf type is not inferred from the path (it is `any` unless you name it:
 *   `storeTarget<number>(...)`), so name it when you want it checked.
 * @returns A target.
 * @category Tracks & clocks
 */
// biome-ignore lint/suspicious/noExplicitAny: the path is a runtime value, so the leaf type cannot be inferred; callers may name it
export function storeTarget<T = any>(
	root: object,
	path: readonly PathKey[],
): Animatable<T> {
	if (path.length === 0) {
		throw new TypeError("storeTarget(): path must have at least one key");
	}
	const parentPath = path.slice(0, -1);
	const leaf = path[path.length - 1] as PathKey;
	const parent = (): Record<PathKey, unknown> => {
		let node = root as Record<PathKey, unknown>;
		for (const key of parentPath) node = node[key] as Record<PathKey, unknown>;
		return node;
	};
	return {
		peek: () => parent()[leaf] as T,
		set(value) {
			parent()[leaf] = value;
		},
	};
}

/**
 * Animates a property of a plain mutable object.
 *
 * A plain assignment: **not reactive**. Nothing that reads the object
 * re-runs; use it for objects you repaint yourself (a canvas model, a
 * three.js-style scene graph) or inside {@link lensTarget} when you also need
 * to poke a track.
 *
 * @param object - The object to mutate.
 * @param key - The property to animate.
 * @returns A target.
 * @category Tracks & clocks
 */
export function propTarget<O extends object, K extends keyof O>(
	object: O,
	key: K,
): Animatable<O[K]> {
	return {
		peek: () => object[key],
		set(value) {
			object[key] = value;
		},
	};
}
