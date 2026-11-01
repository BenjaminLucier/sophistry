/**
 * Wheel routing: a wheel over the canvas goes first to the nodes under the
 * cursor that take wheels (innermost first), then to the scene's listeners in
 * line until one takes it. Also owns the wheel listener's passivity, which is
 * only given up while somebody can claim a wheel. See `./pointer` for the
 * design.
 */

import type { Point } from "../geometry/index.js";
import { applyToPoint, invert } from "../geometry/transform.js";
import { hitTest } from "../interact/hit.js";
import type {
	PointerDriverOptions,
	SceneWheelEvent,
	SceneWheelListener,
	WheelListenerOptions,
} from "./pointer.js";
import type { EventContext, PointerCore } from "./pointer-core.js";
import type { PointerPresence } from "./pointer-presence.js";

/** The scene-level half of wheel routing, for one driver. */
export interface WheelRouter {
	/** Adds a scene listener in line; see `PointerDriver.onWheel`. Returns an unsubscribe. */
	subscribe(
		listener: SceneWheelListener,
		options?: WheelListenerOptions,
	): () => void;
	/**
	 * Re-reads whether anything can claim a wheel and swaps the listener's
	 * passivity to match. The driver calls it when the registry changes.
	 */
	updatePassive(): void;
	/** Removes the canvas wheel listener. */
	destroy(): void;
}

/**
 * Listens for wheels on `options.canvas` and routes them. The registry's
 * `hasWheel` is re-read through {@link WheelRouter.updatePassive}.
 */
export function createWheelRouter(
	core: PointerCore,
	presence: PointerPresence,
	options: Pick<PointerDriverOptions, "canvas" | "registry" | "snapshot">,
): WheelRouter {
	const { canvas, registry } = options;
	/** The scene's wheel listeners, in the order they hear a wheel. */
	const listeners: Array<{ listener: SceneWheelListener; priority: number }> =
		[];

	/**
	 * Offers a wheel to the nodes under the cursor that take wheels, topmost
	 * first, and reports whether one claimed it.
	 *
	 * **The precedence rule:** the innermost handler wins. A node with
	 * `onWheel` (a zoomable plot, a brush) is more specific than the scene's
	 * camera controls, which listen to the whole canvas, so a wheel over it is
	 * its own and stops there — the page keeps still and `panZoom` never
	 * hears it. Nodes without `onWheel` are transparent to the wheel, so a
	 * mark drawn over a zoomable plot (a hoverable bar) does not shield the plot
	 * beneath it; a node that declines (returns `false`) passes it on to the
	 * next one down, then to the scene.
	 */
	function claimWheel(
		native: WheelEvent,
		context: EventContext,
		unitsPerPixel: Point,
	): boolean {
		if (!registry.hasWheel()) return false;
		const declined = new Set<number>();
		const accept = (id: number) =>
			!declined.has(id) && core.handlersOf(id)?.onWheel !== undefined;
		for (;;) {
			const id = hitTest(
				options.snapshot.peek(),
				registry.candidates(),
				context.scene,
				// No fat-finger reach: a wheel comes from a mouse or a trackpad,
				// and a plot's edge should be exactly where its wheel ends.
				{ slop: 0, cache: core.cache, yUp: context.yUp, accept },
			);
			if (id === null) return false;
			const record = core.recordFor(id);
			const handler = record ? record.handlers().onWheel : undefined;
			const taken =
				handler?.({
					native,
					canonical: context.canonical,
					scene: context.scene,
					local: record
						? applyToPoint(record.toLocal(), context.scene)
						: context.scene,
					camera: context.view.camera,
					id,
					unitsPerPixel,
				}) !== false;
			if (handler && taken) {
				native.preventDefault();
				return true;
			}
			declined.add(id);
		}
	}

	/**
	 * Offers an unclaimed wheel to the scene's listeners, in line, until one
	 * takes it.
	 *
	 * **Between scene listeners, the first in line wins.** They all listen to
	 * the whole canvas, so there is no "innermost" to decide by; the line is
	 * `priority`, then subscription order. A listener that is not interested (a `panZoom` for camera 1 under
	 * a wheel over camera 0) returns `false` and the next one hears it, so
	 * listeners for different panes never compete.
	 */
	function offerWheel(event: SceneWheelEvent): void {
		// A copy: a listener may unsubscribe (or subscribe another) while it runs.
		for (const { listener } of [...listeners]) {
			if (listener(event) !== false) {
				event.native.preventDefault?.();
				return;
			}
		}
	}

	function onWheelEvent(native: WheelEvent): void {
		if (listeners.length === 0 && !registry.hasWheel()) return;
		const device = core.devicePoint(native);
		const view = core.viewAt(device);
		if (!view) return;
		const context = core.contextFor(view, device);
		// Device pixels → scene units for this camera, read off the same matrix
		// the position came through rather than reconstructed from `units`, so a
		// delta and a position cannot disagree.
		const toSceneMatrix = invert(core.liveMatrix(view));
		const devicePerCss = core.screenToDevice();
		const unitsPerPixel = {
			x: toSceneMatrix.a * devicePerCss,
			y: toSceneMatrix.d * devicePerCss,
		};
		presence.publish(context, presence.hovered);
		if (claimWheel(native, context, unitsPerPixel)) return;
		offerWheel({
			native,
			canonical: context.canonical,
			scene: context.scene,
			camera: view.camera,
			unitsPerPixel,
		});
	}

	/**
	 * Wheel listening is passive until somebody actually subscribes.
	 *
	 * A zoom has to `preventDefault`, or the page scrolls behind the scene the
	 * user is zooming; and passivity is fixed when the listener is added, so it
	 * cannot be decided per event. Registering non-passive unconditionally would
	 * put every scroll over any canvas — including the overwhelming majority
	 * with no wheel handling at all — behind a main-thread round trip. So it is
	 * swapped when the first subscriber arrives — a scene listener, or a node
	 * with `onWheel` registering — and swapped back when the last one leaves.
	 */
	let wheelPassive = true;
	function setWheelPassive(passive: boolean): void {
		if (passive === wheelPassive) return;
		canvas.removeEventListener("wheel", onWheelEvent);
		wheelPassive = passive;
		canvas.addEventListener("wheel", onWheelEvent, { passive });
	}
	function updateWheelPassive(): void {
		setWheelPassive(listeners.length === 0 && !registry.hasWheel());
	}
	canvas.addEventListener("wheel", onWheelEvent, { passive: wheelPassive });
	updateWheelPassive();

	return {
		subscribe(listener, subscribeOptions) {
			const entry = { listener, priority: subscribeOptions?.priority ?? 0 };
			// After every listener of the same or a higher priority: in line by
			// priority, then by arrival.
			const at = listeners.findIndex((e) => e.priority < entry.priority);
			listeners.splice(at < 0 ? listeners.length : at, 0, entry);
			updateWheelPassive();
			return () => {
				const index = listeners.indexOf(entry);
				if (index >= 0) listeners.splice(index, 1);
				updateWheelPassive();
			};
		},
		updatePassive: updateWheelPassive,
		destroy() {
			canvas.removeEventListener("wheel", onWheelEvent);
		},
	};
}
