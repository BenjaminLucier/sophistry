/**
 * `dropTarget`: the other half of a drag. During a drag, `event.pick(event.id)`
 * is the topmost node under the pointer other than the one in hand; a drop target
 * watches that answer. It is one prop bag (`{ drop }`) because enter, leave, drop
 * and the `over` track only make sense together.
 */

import type {
	DropTarget,
	PointerEvents,
	ScenePointerEvent,
	Sink,
} from "./types.js";

/** @category Interaction */
export interface DropOptions {
	/**
	 * Accepts only some dragged nodes — a slot that takes one kind of thing.
	 *
	 * A declined target still blocks: the drag is not offered to whatever is
	 * beneath, because on screen this is plainly the node under the pointer and a
	 * drop that fell through it would look like a bug.
	 */
	accepts?: (dragged: number) => boolean;
	/**
	 * Written `true` while an accepted node is dragged over this target, `false`
	 * when it leaves, drops or the drag is cancelled. A `track(false)` works.
	 */
	over?: Sink<boolean>;
	/** An accepted dragged node (its scene node id) moved onto this target. */
	onEnter?: (dragged: number, event: ScenePointerEvent) => void;
	/** The dragged node left this target, or the gesture ended over it (after `onDrop`). */
	onLeave?: (dragged: number, event: ScenePointerEvent) => void;
	/**
	 * A gesture released over this target. Fires before `onLeave`, and not at all
	 * for a cancelled gesture — an interrupted drag is not a decision.
	 *
	 * `event.local` is in **this** node's units, not the dragged node's: a drop
	 * handler's question is where in *me* the thing landed.
	 */
	onDrop?: (dragged: number, event: ScenePointerEvent) => void;
	/** CSS cursor while the pointer is over the target. Unset by default. */
	cursor?: string;
	/** Which part of the target answers a hit. The shape's default (`"painted"`) if omitted. */
	pointerEvents?: PointerEvents;
}

/**
 * What `dropTarget` hands back: a prop bag, spreadable onto any shape.
 *
 * @category Interaction
 */
export interface DropTargetProps {
	/** The drop behaviour: pass to a node's `drop` prop (or spread the whole bag). */
	drop: DropTarget;
	/** The `cursor` option, passed through. */
	readonly cursor: string | undefined;
	/** The `pointerEvents` option, passed through. */
	readonly pointerEvents: PointerEvents | undefined;
}

/**
 * Makes any shape a target for whatever is dragged over it.
 *
 * Returns a prop bag to spread onto a shape. While a {@link draggable} node is
 * held, the topmost node under the pointer (other than the held one) is
 * checked: if it is a drop target and `accepts` allows the dragged node, the
 * `over` cell turns true and `onEnter` fires; releasing there calls `onDrop`
 * then `onLeave`. A target that declines still blocks whatever is beneath it.
 * A cancelled drag (Escape, lost pointer) never calls `onDrop`.
 *
 * Dragged and target nodes are identified by their scene node id, the number
 * passed to your callbacks; compare ids rather than positions.
 *
 * @param options - Callbacks, the `over` cell and the `accepts` filter; see {@link DropOptions}.
 * @returns A {@link DropTargetProps} bag to spread onto a node.
 *
 * @category Interaction
 */
export function dropTarget(options: DropOptions = {}): DropTargetProps {
	const drop: DropTarget = {
		accepts: options.accepts,
		over: options.over,
		enter: (event, dragged) => options.onEnter?.(dragged, event),
		leave: (event, dragged) => options.onLeave?.(dragged, event),
		drop: (event, dragged) => options.onDrop?.(dragged, event),
	};
	return {
		drop,
		get cursor() {
			return options.cursor;
		},
		get pointerEvents() {
			return options.pointerEvents;
		},
	};
}
