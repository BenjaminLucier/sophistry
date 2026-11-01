/**
 * The framework-free shapes the pointer driver and the accessibility mirror
 * read: the interaction registry (who wants to be hit, in tree order) and
 * the focus channel. `scene/` implements both over its retained tree; the
 * driver (`render/pointer.ts`) and the mirror (`render/a11y.ts`) only see
 * these interfaces, so `render/` never imports `scene/`.
 *
 * Every member is a plain read of the current state. Change is announced
 * through the `Readable`s (`version`, `focus.state`): subscribers only mark
 * and read with `peek()` later, as everywhere in the core.
 */

import type { Readable } from "../reactive/index.js";
import type { HitCandidate, InteractionRecord } from "./types.js";

/**
 * The interactive nodes of one scene.
 *
 * @category Interaction plumbing
 */
export interface InteractionRegistry {
	/**
	 * Bumped whenever any record may have changed: membership, tree order,
	 * handlers, hit areas. Subscribe to re-read the members below.
	 */
	readonly version: Readable<number>;
	/** The records in tree order (the order nodes sit in the scene tree). */
	records(): readonly InteractionRecord[];
	/** What hit testing consumes: id → candidate, hit areas already in scene units. */
	candidates(): ReadonlyMap<number, HitCandidate>;
	/** The record for a node id, for dispatch. */
	find(id: number): InteractionRecord | undefined;
	/** Whether anything declares a drag (drives the canvas's `touch-action`). */
	hasDrag(): boolean;
	/** Whether anything cares about hover (enter/leave, `hover`, a cursor). */
	hasHover(): boolean;
	/** Whether anything is a drop target. */
	hasDrop(): boolean;
	/** Whether anything takes the wheel itself (`onWheel`). */
	hasWheel(): boolean;
	/** The tab stops, in tree order: the tab order. */
	focusable(): readonly InteractionRecord[];
	/** Every record sharing a node's focus, itself included (an interaction group's members). */
	membersOf(id: number): readonly InteractionRecord[];
}

/**
 * Where focus came from: the keyboard shows a ring, a pointer does not.
 *
 * @category Interaction plumbing
 */
export type FocusSource = "keyboard" | "pointer" | "script";

/**
 * The focused node of one scene.
 *
 * @category Interaction plumbing
 */
export interface FocusChannel {
	/** The focused node id and how it got focus; `id` null when nothing is focused. */
	readonly state: Readable<{ id: number | null; source: FocusSource }>;
	/** Moves focus (null clears it). */
	set(id: number | null, source?: FocusSource): void;
}
