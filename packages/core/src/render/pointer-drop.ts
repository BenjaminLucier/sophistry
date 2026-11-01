/**
 * Drop targets during a drag: what the thing in hand is over, as enter/leave
 * transitions, and the drop (or leave) when the gesture ends. See `./pointer`
 * for the design and `./pointer-gestures` for the gesture these extend.
 */

import type { InteractionRegistry } from "../interact/registry.js";
import { writeSink } from "../interact/types.js";
import type { EventContext, PointerCore } from "./pointer-core.js";
import type { Gesture } from "./pointer-gestures.js";

/**
 * What the thing in hand is over, as a transition.
 *
 * Structurally hover's twin — the same "which node is under this point"
 * question, asked with the dragged node excluded — and emitted the same way,
 * on changes rather than per move, so crossing a target costs an enter and a
 * leave instead of one call per pointer event.
 *
 * The extra hit test per move is real work on the gesture path, so it is
 * skipped entirely unless something in the scene is a target or the drag
 * itself asked to be told. A scene of ordinary draggables pays nothing.
 */
export function updateDropTarget(
	core: PointerCore,
	registry: InteractionRegistry,
	native: PointerEvent,
	context: EventContext,
	gesture: Gesture,
): void {
	const drag = gesture.drag;
	if (!drag || gesture.id === null) return;
	if (!registry.hasDrop() && !drag.over) return;

	const found = core.hitIn(context, gesture.id);
	if (found === gesture.over) return;
	gesture.over = found;

	if (gesture.target) {
		if (gesture.target.over) writeSink(gesture.target.over, false);
		gesture.target.leave?.(
			core.makeEvent(native, context, gesture.targetId),
			gesture.id,
		);
		gesture.target = null;
		gesture.targetId = null;
	}

	const candidate =
		found === null ? null : (core.handlersOf(found)?.drop ?? null);
	if (candidate && (candidate.accepts?.(gesture.id) ?? true)) {
		gesture.target = candidate;
		gesture.targetId = found;
		if (candidate.over) writeSink(candidate.over, true);
		candidate.enter?.(core.makeEvent(native, context, found), gesture.id);
	}

	// The dragged node hears the raw answer, target or not: "am I over the
	// right thing?" is a question about the scene, and a node that declined
	// the drop is still what is under the pointer.
	drag.over?.(core.makeEvent(native, context, gesture.id), found);
}

/** Drops on (or, cancelled, just leaves) the target a gesture ended over. */
export function finishDropTarget(
	core: PointerCore,
	gesture: Gesture,
	native: PointerEvent,
	context: EventContext,
	cancelled: boolean,
): void {
	const target = gesture.target;
	if (!target || gesture.id === null) return;
	// The target's own units, because a drop handler's question is where in
	// *me* the thing landed.
	const event = core.makeEvent(native, context, gesture.targetId);
	// Drop first, then leave: a highlight must come off however the gesture
	// ended, and a handler that advances a lesson wants to run while the thing
	// is still notionally over the target.
	if (!cancelled) target.drop?.(event, gesture.id);
	if (target.over) writeSink(target.over, false);
	target.leave?.(event, gesture.id);
	gesture.target = null;
	gesture.targetId = null;
	gesture.over = null;
}
