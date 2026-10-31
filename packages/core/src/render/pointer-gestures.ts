/**
 * The gesture state machine: one `Gesture` per pointer that is down, from
 * pointerdown (lock the camera, capture, hit-test, offer the drag) through
 * moves (slop, drag, drop targets) to the end (drag settles, tap, double tap,
 * or a background event nobody claimed). See `./pointer` for the design.
 */

import type { Point } from "../geometry";
import type { DragBehaviour, DropTarget } from "../interact/types";
import { isFocusable, writeSink } from "../interact/types";
import type { BackgroundPointerEvent, PointerDriverOptions } from "./pointer";
import type { EventContext, LockedView, PointerCore } from "./pointer-core";
import { detachedView } from "./pointer-core";
import { finishDropTarget, updateDropTarget } from "./pointer-drop";
import type { PointerPresence } from "./pointer-presence";

/** One pointer's press, from pointerdown until it ends. */
export interface Gesture {
	pointerId: number;
	view: LockedView;
	/** The node hit at pointerdown, or null for a background gesture. */
	id: number | null;
	drag: DragBehaviour | null;
	/** CSS pixels, for the movement threshold — the space slop is stated in. */
	startClient: Point;
	startTime: number;
	moved: boolean;
	consumed: boolean;
	longPress: ReturnType<typeof setTimeout> | null;
	captured: boolean;
	/** The topmost node under the pointer that isn't the one in hand. */
	over: number | null;
	/** The drop target currently entered — `over`'s, if it accepted. */
	target: DropTarget | null;
	targetId: number | null;
}

/** The pointer listeners and the gestures in flight, for one driver. */
export interface GestureMachine {
	/** Every pointer currently down, live in canonical pixels (see `PointerDriver.pointers`). */
	readonly pointers: Map<number, Point>;
	/** How many gestures are in flight. */
	readonly size: number;
	onPointerDown(native: PointerEvent): void;
	onPointerMove(native: PointerEvent): void;
	onPointerUp(native: PointerEvent): void;
	onPointerCancel(native: PointerEvent): void;
	onPointerLeave(native: PointerEvent): void;
	onContextMenu(native: MouseEvent): void;
	/** Ends every gesture in flight (or those begun on node `id`) as cancelled. */
	cancel(id?: number | null): boolean;
	/** Cancels and drops every gesture (driver teardown). */
	destroy(): void;
}

/** Builds the {@link GestureMachine} for one driver. */
export function createGestureMachine(
	core: PointerCore,
	presence: PointerPresence,
	options: PointerDriverOptions,
	emitBackground: (event: BackgroundPointerEvent) => void,
): GestureMachine {
	const { canvas, registry } = options;
	const tapTimeout = options.tapTimeout ?? 500;
	const longPressDelay = options.longPressDelay ?? 500;
	const doubleTapDelay = options.doubleTapDelay ?? 300;
	const { handlersOf, makeEvent } = core;

	const pointers = new Map<number, Point>();
	const gestures = new Map<number, Gesture>();
	let lastTap: { id: number; time: number } | null = null;

	function cancelLongPress(gesture: Gesture): void {
		if (gesture.longPress === null) return;
		clearTimeout(gesture.longPress);
		gesture.longPress = null;
	}

	function finish(
		gesture: Gesture,
		native: PointerEvent,
		context: EventContext,
		cancelled: boolean,
	): void {
		cancelLongPress(gesture);
		gestures.delete(gesture.pointerId);
		pointers.delete(gesture.pointerId);
		// A finger that lifts is a pointer that is no longer anywhere; a mouse
		// button that lifts leaves the cursor exactly where it was. Publishing
		// `null` for both would make a touch readout correct and a mouse one blink.
		if (native.pointerType === "touch") presence.publishAway();
		if (gesture.captured) {
			// Releasing a capture the browser has already taken back throws.
			try {
				canvas.releasePointerCapture(gesture.pointerId);
			} catch {
				/* already released */
			}
		}

		if (gesture.drag) {
			// The drag settles first — a cancelled one restores its origin here —
			// so a drop handler reading the dragged cell sees its final value.
			const began =
				gesture.drag.end(makeEvent(native, context, gesture.id), cancelled) !==
				false;
			finishDropTarget(core, gesture, native, context, cancelled);
			// A press that claimed the gesture but never crossed the drag's own
			// threshold was not a drag: fall through so it can still be a tap.
			if (began || cancelled) return;
		}

		const handlers = handlersOf(gesture.id);
		if (handlers?.onPointerUp) {
			handlers.onPointerUp(makeEvent(native, context, gesture.id));
			gesture.consumed = true;
		}

		// A tap is a press that stayed put and did not linger. One that wandered
		// past the slop is a drag that nothing claimed, and one that outlasted the
		// timeout is a hold — neither is a click, and treating them as one is how
		// a scrubbed slider ends up also firing its button.
		const held = native.timeStamp - gesture.startTime;
		const isTap = !cancelled && !gesture.moved && held <= tapTimeout;
		if (isTap && gesture.id !== null) {
			const event = makeEvent(native, context, gesture.id);
			if (handlers?.onTap) {
				handlers.onTap(event);
				gesture.consumed = true;
			}
			const previous = lastTap;
			if (
				previous &&
				previous.id === gesture.id &&
				native.timeStamp - previous.time <= doubleTapDelay
			) {
				lastTap = null;
				if (handlers?.onDoubleTap) {
					handlers.onDoubleTap(event);
					gesture.consumed = true;
				}
			} else {
				lastTap = { id: gesture.id, time: native.timeStamp };
			}
		}

		// "Background" is not "hit nothing" — it is "nobody claimed it". A node
		// whose `drag` declined, or one carrying only a `hover`, leaves the
		// gesture available to whatever is beneath, which is exactly what the
		// `DragBehaviour.start` veto is for.
		if (!gesture.consumed && !context.consumed) {
			emitBackground({
				phase: cancelled ? "cancel" : "up",
				native,
				pointerId: gesture.pointerId,
				canonical: context.canonical,
				scene: context.scene,
				camera: context.view.camera,
			});
		}
	}

	function onPointerDown(native: PointerEvent): void {
		// Only the primary contact starts a gesture: a mouse's left button, a
		// finger or a pen tip all report `button === 0`, whereas right, middle,
		// back/forward and a pen's barrel or eraser report something else. These
		// must not fire `onPointerDown`/`onTap` or start a pan; the context menu
		// has its own event. `isPrimary` is deliberately *not* the test — a
		// second finger is not primary, and a pinch needs it.
		if (native.button > 0) return;
		const device = core.devicePoint(native);
		const view = core.viewAt(device);
		if (!view) return;
		const context = core.contextFor(view, device);
		pointers.set(native.pointerId, core.livePoint(view, device));
		presence.resting = { device, native };

		const id = core.hitIn(context);
		presence.updateHover(native, context, id);
		presence.publish(context, id);

		const gesture: Gesture = {
			pointerId: native.pointerId,
			view,
			id,
			drag: null,
			startClient: { x: native.clientX, y: native.clientY },
			startTime: native.timeStamp,
			moved: false,
			consumed: false,
			longPress: null,
			captured: false,
			over: null,
			target: null,
			targetId: null,
		};
		gestures.set(native.pointerId, gesture);

		// Focus follows the press, so that clicking a handle and then pressing an
		// arrow key moves the handle you just clicked. A press on the background
		// clears it, exactly as clicking off a form control does.
		if (options.focus) {
			const record = core.recordFor(id);
			const focusable = !!record && isFocusable(record);
			writeSink(options.focus, focusable ? id : null);
			// The browser's own default for the press (the compatibility
			// `mousedown`) moves focus to the nearest focusable ancestor of the
			// canvas — the body — right after the mirror took it, so the keys a
			// press is meant to enable (Escape cancelling this very drag, the
			// arrows) would go nowhere. Pointer capture and the gesture are
			// unaffected; only the compatibility mouse events are skipped.
			if (focusable) native.preventDefault?.();
		}

		// Captured unconditionally, before any handler runs: a gesture that leaves
		// the canvas has to keep being delivered here, and a gesture that ends
		// outside it has to end rather than being lost.
		try {
			canvas.setPointerCapture(native.pointerId);
			gesture.captured = true;
		} catch {
			/* pointer already gone */
		}

		const handlers = handlersOf(id);
		if (handlers?.onPointerDown) {
			handlers.onPointerDown(makeEvent(native, context, id));
			gesture.consumed = true;
		}

		// The drag seam. This file knows that a behaviour can decline and that a
		// gesture it accepts belongs to it until it ends; it knows nothing about
		// what a drag does, which is what lets `interact/drag.ts` be written
		// without touching a DOM event.
		const behaviour = handlers?.drag;
		if (behaviour) {
			if (behaviour.start(makeEvent(native, context, id))) {
				gesture.drag = behaviour;
				gesture.consumed = true;
			}
		}

		if (handlers?.onLongPress) {
			gesture.longPress = setTimeout(() => {
				gesture.longPress = null;
				if (gesture.moved) return;
				handlers.onLongPress?.(makeEvent(native, context, id));
			}, longPressDelay);
		}

		if (!gesture.consumed && !context.consumed) {
			emitBackground({
				phase: "down",
				native,
				pointerId: native.pointerId,
				canonical: context.canonical,
				scene: context.scene,
				camera: view.camera,
			});
		}
	}

	function onPointerMove(native: PointerEvent): void {
		const device = core.devicePoint(native);
		const gesture = gestures.get(native.pointerId);

		// Mid-gesture the camera is the one picked at pointerdown; otherwise it is
		// whichever view the pointer is over right now.
		const view = gesture ? gesture.view : core.viewAt(device);
		if (!view) return;
		const context = core.contextFor(view, device);
		presence.resting = { device, native };

		if (!gesture) {
			pointers.delete(native.pointerId);
			const id = core.hitIn(context);
			presence.updateHover(native, context, id);
			presence.publish(context, id);
			return;
		}

		pointers.set(native.pointerId, core.livePoint(view, device));
		// Mid-gesture the hit test is not re-run — the node in hand is the node in
		// hand — so the published id is the one hover settled on.
		presence.publish(context, presence.hovered);
		if (!gesture.moved) {
			const dx = native.clientX - gesture.startClient.x;
			const dy = native.clientY - gesture.startClient.y;
			if (Math.hypot(dx, dy) > core.slopScreen) {
				gesture.moved = true;
				cancelLongPress(gesture);
			}
		}

		if (gesture.drag) {
			gesture.drag.move(makeEvent(native, context, gesture.id));
			updateDropTarget(core, registry, native, context, gesture);
			return;
		}

		const handlers = handlersOf(gesture.id);
		if (handlers?.onPointerMove) {
			handlers.onPointerMove(makeEvent(native, context, gesture.id));
			gesture.consumed = true;
		}

		if (!gesture.consumed && !context.consumed) {
			emitBackground({
				phase: "move",
				native,
				pointerId: native.pointerId,
				canonical: context.canonical,
				scene: context.scene,
				camera: view.camera,
			});
		}
	}

	/** Ends the gesture of `native`'s pointer, if it has one. */
	function end(native: PointerEvent, cancelled: boolean): void {
		const gesture = gestures.get(native.pointerId);
		if (!gesture) return;
		finish(
			gesture,
			native,
			core.contextFor(gesture.view, core.devicePoint(native)),
			cancelled,
		);
	}

	function onPointerLeave(native: PointerEvent): void {
		if (gestures.has(native.pointerId)) return;
		const device = core.devicePoint(native);
		const view = core.viewAt(device) ?? detachedView();
		presence.resting = null;
		presence.clearHover(native, core.contextFor(view, device));
		presence.publishAway();
	}

	function onContextMenu(native: MouseEvent): void {
		const device = core.devicePoint(native);
		const view = core.viewAt(device);
		if (!view) return;
		const context = core.contextFor(view, device);
		const id = core.hitIn(context);
		const handlers = handlersOf(id);
		if (!handlers?.onContextMenu) return;
		// `contextmenu` is a `PointerEvent` in some engines and a plain
		// `MouseEvent` in others, so the id is read defensively rather than
		// assumed; -1 says "no pointer" without pretending to be pointer 0.
		const pointer = native as PointerEvent;
		const pointerId =
			typeof pointer.pointerId === "number" ? pointer.pointerId : -1;
		handlers.onContextMenu(makeEvent(pointer, context, id, pointerId));
	}

	/**
	 * Without a resolved position to hand the handlers there is nothing to
	 * deliver, so the gestures are simply dropped. With one, the last resolved
	 * position is the right one — a key press carries no coordinates, and it
	 * is where the gesture was when it was interrupted.
	 */
	function cancel(id?: number | null): boolean {
		const last = presence.resting;
		let cancelled = false;
		for (const gesture of [...gestures.values()]) {
			if (id !== undefined && id !== null && gesture.id !== id) continue;
			cancelled = true;
			if (!last) {
				cancelLongPress(gesture);
				gestures.delete(gesture.pointerId);
				continue;
			}
			finish(
				gesture,
				last.native,
				core.contextFor(gesture.view, last.device),
				true,
			);
		}
		return cancelled;
	}

	function destroy(): void {
		// A drag torn down mid-flight is a cancelled one, so it restores its
		// origin and clears any drop-target highlight rather than being left
		// half-applied.
		cancel();
		for (const gesture of gestures.values()) cancelLongPress(gesture);
		gestures.clear();
		pointers.clear();
		lastTap = null;
	}

	return {
		pointers,
		get size() {
			return gestures.size;
		},
		onPointerDown,
		onPointerMove,
		onPointerUp: (native) => end(native, false),
		onPointerCancel: (native) => end(native, true),
		onPointerLeave,
		onContextMenu,
		cancel,
		destroy,
	};
}
