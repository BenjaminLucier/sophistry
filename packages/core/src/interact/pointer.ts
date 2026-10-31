/**
 * Where the pointer is: a scene-level `Readable` any scene code can read
 * (`scene.pointer`) for crosshairs, readouts and brushes, as opposed to the
 * gesture events a node is handed. The pointer driver fills it in; it lives in
 * `interact/` so neither scene code nor the driver depends on the other.
 */

import type { Point } from "../geometry";
import type { Readable } from "../reactive";
import { track } from "../reactive";

/**
 * The pointer over a canvas, resolved into the spaces a scene reads in.
 *
 * **Per canvas, and in scene units.** There is one pointer and one answer, even
 * on a scene showing four cameras: `scene` is the scene point under the pointer
 * through the camera it is over (the space the specs are in), the same
 * argument that makes `scene.frame` scene-wide. An answer per camera would
 * have to be a different position in a different space for a pointer that is
 * only ever in one place. `camera` says which view it is over, so a scene that
 * genuinely cares can branch on it.
 *
 * @category Interaction
 */
export interface ScenePointer {
	/**
	 * The scene's own-framing pixels (its `units`/`center`/`yUp`, device pixels
	 * of the canvas without cameras): a camera-independent screen-ish space.
	 * Not the space specs are in; that is `scene`.
	 */
	canonical: Point;
	/** Scene units. */
	scene: Point;
	/** The topmost interactive node under the pointer, or null for none. */
	id: number | null;
	/** Index into the camera list, or -1 for a scene without cameras. */
	camera: number;
}

/**
 * The scene's published pointer: a `Readable` that is null while no pointer is
 * over the canvas, and the write end only the pointer driver is meant to hold.
 *
 * @category Interaction plumbing
 */
export interface PointerChannel {
	/** The read side, as `scene.pointer` exposes it. */
	readonly state: Readable<ScenePointer | null>;
	/** Publishes a new position, or `null` when the pointer leaves. */
	set(value: ScenePointer | null): void;
}

/**
 * Two published pointers that say the same thing.
 *
 * @category Interaction plumbing
 */
export function samePointer(
	a: ScenePointer | null,
	b: ScenePointer | null,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.id === b.id &&
		a.camera === b.camera &&
		a.scene.x === b.scene.x &&
		a.scene.y === b.scene.y &&
		a.canonical.x === b.canonical.x &&
		a.canonical.y === b.canonical.y
	);
}

/**
 * Creates the pointer-position channel for one scene. `createScene` does this
 * for you; it is exported for hosting a scene on your own canvas.
 *
 * @example
 * ```ts
 * import { createPointerChannel } from "@sophistry/core";
 *
 * const pointer = createPointerChannel();
 * pointer.state.subscribe(() => console.log(pointer.state.peek()?.scene));
 * pointer.set({ canonical: { x: 0, y: 0 }, scene: { x: 1, y: 2 }, id: null, camera: -1 });
 * ```
 *
 * @returns A {@link PointerChannel}, initially away (`null`).
 *
 * @category Interaction plumbing
 */
export function createPointerChannel(): PointerChannel {
	// Compared by value: every publish is a fresh record, and a publish that
	// says nothing new must not wake readers. The driver re-publishes whenever
	// the scene changes under a still pointer (the view may have moved), and a
	// reader that draws into the scene (a tooltip following the pointer) would
	// otherwise change the scene, be re-published to, and loop for ever.
	const pointer = track<ScenePointer | null>(null, { equals: samePointer });
	return {
		state: { peek: pointer.peek, subscribe: pointer.subscribe },
		set: (value) => pointer.set(value),
	};
}
