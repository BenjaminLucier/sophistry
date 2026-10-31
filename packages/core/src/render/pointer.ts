/**
 * The pointer driver: the only place that handles DOM pointer events. Per event
 * it maps CSS pixels to device pixels, picks the camera, maps through that
 * view's inverse matrix to scene units, and hit-tests the registry.
 *
 * Hit testing is off the render path (hover is re-tested on snapshot change only
 * when something cares). Slop is in screen pixels, divided by the camera scale;
 * the camera is locked at pointerdown; every press takes pointer capture, and
 * `lostpointercapture`/`pointercancel` are cancelled ends. It also writes the
 * scene's pointer channel (`scene.pointer`). Parts: `pointer-core`,
 * `pointer-presence`, `pointer-gestures` + `pointer-drop`, `pointer-wheel`.
 */

import type { Point } from "../geometry";
import type { Matrix } from "../geometry/transform";
import { applyToPoint, invert } from "../geometry/transform";
import { isYUp } from "../geometry/view-matrix";
import type { ScenePointer } from "../interact/pointer";
import type { InteractionRegistry } from "../interact/registry";
import type { Sink } from "../interact/types";
import type { Readable } from "../reactive";
import type { DrawSpec } from "../spec/types";
import { requestFrame } from "../tween/frame-loop";
import type { CameraView } from "./camera";
import { createPointerCore } from "./pointer-core";
import { createGestureMachine } from "./pointer-gestures";
import { createPointerPresence } from "./pointer-presence";
import { createWheelRouter } from "./pointer-wheel";

/**
 * A gesture that landed on no node, or on one that declined it.
 *
 * The whole of what a camera pan needs from this file, and deliberately not
 * more: a position in both spaces, which camera it belongs to, and where in the
 * gesture's life it is.
 *
 * @category Interaction plumbing
 */
export interface BackgroundPointerEvent {
	/** Where the gesture is: `"cancel"` is an interrupted end (lost capture, `pointercancel`, Escape). */
	phase: "down" | "move" | "up" | "cancel";
	/** The DOM event, for `preventDefault` and modifier keys. */
	native: PointerEvent;
	/** The browser's id for this pointer; stable for the gesture's life. */
	pointerId: number;
	/**
	 * Pointer position in the scene's *canonical* pixels: where the scene's own
	 * framing (`units`/`center`/`yUp` of the scene itself, ignoring every
	 * camera) puts the scene point under the pointer — device pixels on a
	 * scene without cameras. A camera-independent pixel space for gesture maths; not
	 * screen pixels once a camera pane is zoomed or panned, and not the space
	 * specs are in (that is `scene`).
	 */
	canonical: Point;
	/**
	 * Pointer position in the scene's scene units, through the locked camera's
	 * mapping as it is *now* — it tracks a camera moved mid-gesture.
	 */
	scene: Point;
	/** Index of the camera the gesture is locked to, or `-1` on a scene without cameras. */
	camera: number;
}

/**
 * A wheel event resolved into scene coordinates.
 *
 * @category Interaction plumbing
 */
export interface SceneWheelEvent {
	/** The DOM event. Call `preventDefault()` to stop the page scrolling. */
	native: WheelEvent;
	/** Cursor position in the scene's canonical pixels (see {@link BackgroundPointerEvent.canonical}). */
	canonical: Point;
	/** Cursor position in scene units, through the camera it is over. */
	scene: Point;
	/** Index of the camera under the cursor, or `-1` on a scene without cameras. */
	camera: number;
	/**
	 * Scene units per CSS pixel of screen movement, per axis and *signed*.
	 *
	 * A wheel's `deltaX`/`deltaY` are the one input here that is a screen
	 * displacement rather than a position, so it is the one thing that cannot be
	 * resolved by mapping a point. The sign carries the y flip, so `y` is
	 * negative under the maths convention and a caller adds rather than
	 * remembering which way up the scene is.
	 */
	unitsPerPixel: Point;
}

/**
 * A scene-level wheel listener (see {@link PointerDriver.onWheel}): returns
 * `false` to pass the wheel on to the next listener, anything else to take it.
 *
 * @category Interaction plumbing
 */
// biome-ignore lint/suspicious/noConfusingVoidType: a listener that always takes the wheel returns nothing
export type SceneWheelListener = (event: SceneWheelEvent) => boolean | void;

/**
 * Where a scene-level wheel listener stands in line.
 *
 * @category Interaction plumbing
 */
export interface WheelListenerOptions {
	/**
	 * Higher hears the wheel first. Listeners with the same priority hear it
	 * in the order they subscribed.
	 *
	 * @default 0
	 */
	priority?: number;
}

/** @category Interaction plumbing */
export interface PointerDriverOptions {
	/** The canvas to listen on. Pointer coordinates are read relative to its box. */
	canvas: HTMLCanvasElement;
	/** The element carrying `user-select`/callout suppression. Defaults to the canvas. */
	host?: HTMLElement;
	/** The interactive nodes to hit-test against. */
	registry: InteractionRegistry;
	/**
	 * The renderer's z-sorted snapshot (what it was last handed with
	 * `setFrame`). Must go stale whenever a new frame is handed over: a resting
	 * pointer is re-tested then.
	 */
	snapshot: Readable<readonly DrawSpec[]>;
	/** Backing-store size in device pixels. */
	size: Readable<{ width: number; height: number }>;
	/**
	 * The scene's own view matrix (scene units → device pixels from its
	 * `units`/`center`/`yUp`). The view of a scene without cameras, and the
	 * definition of the camera-independent `canonical` pixels events also report.
	 */
	canonicalView: Readable<Matrix>;
	/** Camera views. Omitted or empty is the single-view path. */
	cameraViews?: Readable<readonly CameraView[]>;
	/**
	 * Device pixels per CSS pixel; only used before the canvas has a layout box.
	 * @default 1
	 */
	dpr?: Readable<number>;
	/**
	 * Where to publish the scene-level pointer position: the write end of
	 * `interact/pointer.ts`'s channel, which `scene.pointer` reads. A `Sink`, so
	 * a test can pass a plain function.
	 */
	pointer?: Sink<ScenePointer | null>;
	/**
	 * Where to publish the node a press landed on: the pointer half of focus.
	 *
	 * Written with the id of the focusable node under the press, or null for a
	 * press on the background, so that clicking a handle and then pressing an
	 * arrow key moves *that* handle. The accessibility mirror turns it into real
	 * DOM focus; this file only reports what was pressed, and deliberately does
	 * not know that a ring is drawn or that a `<div>` exists.
	 */
	focus?: Sink<number | null>;
	/**
	 * Fat-finger radius in CSS pixels. The default matches `draggable`'s default `threshold`.
	 * @default 8
	 */
	slop?: number;
	/**
	 * Longest a press can last and still be a tap, in ms.
	 * @default 500
	 */
	tapTimeout?: number;
	/**
	 * How long a press must be held to be a long press, in ms.
	 * @default 500
	 */
	longPressDelay?: number;
	/**
	 * Longest gap between two taps that still reads as a double tap.
	 * @default 300
	 */
	doubleTapDelay?: number;
	/**
	 * Runs the driver's deferred work (re-testing a resting pointer after the
	 * view or the scene moved under it, re-reading the registry for
	 * `touch-action`, `user-select` and the wheel's passivity) once, soon.
	 * Returns a function withdrawing the request. Defaults to the shared frame
	 * loop's commit phase (`requestFrame("commit", run)`), which runs after the
	 * scene's own commit has handed the renderer its new frame, so a hover
	 * handler's writes land in the same frame. Tests pass their own.
	 */
	schedule?: (run: () => void) => (() => void) | undefined;
}

/**
 * The handle a scene's pointer driver exposes to camera controllers such as
 * `panZoom` and `OrbitControls3D`, and to the accessibility layer. Most scene
 * code never needs it and should use node props (`onTap`, `drag`, ...) or
 * `node.on(...)` instead.
 *
 * @category Interaction plumbing
 */
export interface PointerDriver {
	/**
	 * Every pointer currently down, in canonical pixels (see
	 * {@link BackgroundPointerEvent.canonical}).
	 *
	 * Live and mutable rather than a snapshot, because the thing that needs it —
	 * a two-finger pinch — wants the other finger's position at the moment the
	 * first one moves, not as of the last render. The points are *live* too: each
	 * is resolved through the pointer's locked camera as it is when read, so a
	 * stationary finger tracks a camera that moved since its last event.
	 */
	pointers: Map<number, Point>;
	/**
	 * Canonical pixels → scene units, at this instant.
	 *
	 * The companion `pointers` needs: that map is in canonical pixels, and a
	 * pinch has to compare it against the scene-unit cells it writes. Camera
	 * framing does not enter into it — the canonical space is fixed by the
	 * scene's own framing, which is exactly why a camera can be panned without
	 * invalidating it.
	 */
	toScene(at: Point): Point;
	/**
	 * The topmost interactive node at a canonical-pixel point (converted to scene
	 * units through the scene's own framing), ignoring the node id `exclude`;
	 * `null` if none.
	 */
	pick(at: Point, exclude?: number | null): number | null;
	/** Gestures that hit no node and were not consumed. Returns an unsubscribe. */
	onBackground(listener: (event: BackgroundPointerEvent) => void): () => void;
	/**
	 * Wheel events no node claimed (a node's `onWheel` goes first). Listeners hear
	 * it one at a time by descending `priority`, then subscription order; returning
	 * anything but `false` takes it (and prevents page scroll). Returns an
	 * unsubscribe.
	 */
	onWheel(
		listener: SceneWheelListener,
		options?: WheelListenerOptions,
	): () => void;
	/**
	 * Asks the browser to stop handling touch gestures itself, until released.
	 *
	 * `touch-action` otherwise tracks whether the scene holds anything draggable,
	 * which is deliberate — a canvas with nothing to drag must not eat the page's
	 * scroll on a phone. A camera pan *is* something to drag, but it is a
	 * property of a component rather than of the node registry, so it says so
	 * here instead. Refcounted, because two panes can each want it.
	 */
	claimTouch(): () => void;
	/**
	 * Ends any gesture in flight as **cancelled** — the Escape key's meaning.
	 *
	 * Cancelled, never completed: `interact/drag.ts` restores the origin exactly
	 * on a cancelled end, so this is an undo rather than a commit. `id` limits it
	 * to gestures that began on one node. Returns whether any gesture was in
	 * flight to cancel.
	 */
	cancel(id?: number | null): boolean;
	/** Removes every listener and drops gestures in flight (as cancelled). Idempotent. */
	destroy(): void;
}

/**
 * Attaches pointer, wheel and context-menu listeners to a canvas and dispatches
 * node gestures (`createScene` does this for you for a scene with a canvas).
 * A tap is a press released within `tapTimeout` ms without moving past `slop`;
 * a second within `doubleTapDelay` ms is a double tap; holding `longPressDelay`
 * ms fires `onLongPress`. Unclaimed gestures go to `onBackground`.
 *
 * @param options - See {@link PointerDriverOptions}.
 * @returns The {@link PointerDriver}.
 *
 * @category Interaction plumbing
 */
export function createPointerDriver(
	options: PointerDriverOptions,
): PointerDriver {
	const { canvas, registry } = options;
	const host = options.host ?? canvas;

	const core = createPointerCore(options);
	const presence = createPointerPresence(core, options);
	const backgroundListeners = new Set<
		(event: BackgroundPointerEvent) => void
	>();
	const gestures = createGestureMachine(core, presence, options, (event) => {
		for (const listener of backgroundListeners) listener(event);
	});

	canvas.addEventListener("pointerdown", gestures.onPointerDown);
	canvas.addEventListener("pointermove", gestures.onPointerMove);
	canvas.addEventListener("pointerup", gestures.onPointerUp);
	canvas.addEventListener("pointercancel", gestures.onPointerCancel);
	// A lost capture is an interruption, never a completion — the gesture stops
	// being deliverable, so anything mid-flight has to unwind rather than commit.
	canvas.addEventListener("lostpointercapture", gestures.onPointerCancel);
	canvas.addEventListener("pointerleave", gestures.onPointerLeave);
	canvas.addEventListener("contextmenu", gestures.onContextMenu);

	const wheel = createWheelRouter(core, presence, options);

	let touchClaims = 0;

	/**
	 * `touch-action`, set from whether anything in the scene declares a drag.
	 *
	 * The browser evaluates it when a gesture *starts*, so setting it inside
	 * pointerdown is already too late; and setting it unconditionally would stop
	 * the page scrolling under a finger that landed on a canvas with nothing to
	 * drag, which on a phone reads as the page being broken. So it tracks the
	 * registry, and a scene of non-draggable shapes stays scrollable.
	 */
	function applyTouchAction(): void {
		const claimed = registry.hasDrag() || touchClaims > 0;
		canvas.style.touchAction = claimed ? "none" : "";
	}

	/**
	 * What follows the registry: `touch-action`, the wheel's passivity, and
	 * text-selection suppression. A gesture over a shape must not select the
	 * text around it or raise iOS's link callout, both of which read as the
	 * canvas having failed to respond.
	 */
	let interactive: string | null = null;
	function syncRegistry(): void {
		applyTouchAction();
		wheel.updatePassive();
		const next = registry.records().length > 0 ? "none" : "";
		if (next === interactive) return;
		interactive = next;
		host.style.setProperty("user-select", next);
		host.style.setProperty("-webkit-user-select", next);
		host.style.setProperty("-webkit-touch-callout", next);
	}

	/**
	 * Re-tests hover and republishes `scene.pointer` when the view moves under a
	 * resting pointer (snapshot, framing, cameras, size, dpr, the registry), but
	 * only hit-tests when something cares about hover.
	 */
	let destroyed = false;
	let withdraw: (() => void) | null = null;
	const refresh = () => {
		withdraw = null;
		if (destroyed) return;
		syncRegistry();
		if (gestures.size > 0) return;
		presence.retest(registry.hasHover());
	};
	const schedule =
		options.schedule ?? ((run: () => void) => requestFrame("commit", run));
	// Subscribers only mark: the work is one scheduled run however many of
	// these went stale before it.
	const requestRefresh = () => {
		if (destroyed || withdraw) return;
		withdraw = schedule(refresh) ?? (() => {});
	};
	const stops = [
		options.snapshot,
		registry.version,
		options.canonicalView,
		options.cameraViews,
		options.size,
		options.dpr,
	].map((source) => source?.subscribe(requestRefresh));
	syncRegistry();

	const destroy = () => {
		if (destroyed) return;
		destroyed = true;
		withdraw?.();
		withdraw = null;
		for (const stop of stops) stop?.();
		canvas.removeEventListener("pointerdown", gestures.onPointerDown);
		canvas.removeEventListener("pointermove", gestures.onPointerMove);
		canvas.removeEventListener("pointerup", gestures.onPointerUp);
		canvas.removeEventListener("pointercancel", gestures.onPointerCancel);
		canvas.removeEventListener("lostpointercapture", gestures.onPointerCancel);
		canvas.removeEventListener("pointerleave", gestures.onPointerLeave);
		canvas.removeEventListener("contextmenu", gestures.onContextMenu);
		wheel.destroy();
		gestures.destroy();
		presence.release();
		presence.publishAway();
		canvas.style.cursor = "";
		canvas.style.touchAction = "";
		host.style.setProperty("user-select", "");
		host.style.setProperty("-webkit-user-select", "");
		host.style.setProperty("-webkit-touch-callout", "");
	};

	return {
		pointers: gestures.pointers,
		toScene: (at) => applyToPoint(invert(options.canonicalView.peek()), at),
		pick: (at, exclude = null) => {
			const view = options.canonicalView.peek();
			return core.pick(applyToPoint(invert(view), at), exclude, 0, isYUp(view));
		},
		onBackground(listener) {
			backgroundListeners.add(listener);
			return () => {
				backgroundListeners.delete(listener);
			};
		},
		onWheel: wheel.subscribe,
		cancel: gestures.cancel,
		claimTouch() {
			touchClaims++;
			applyTouchAction();
			let released = false;
			return () => {
				if (released) return;
				released = true;
				touchClaims--;
				if (!destroyed) applyTouchAction();
			};
		},
		destroy,
	};
}
