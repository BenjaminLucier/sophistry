/**
 * Where the pointer is when no gesture says otherwise: the hovered node (enter
 * and leave as hit-test transitions, and the cursor), the resting position the
 * scene can move under, and the scene-level position `scene.pointer` reads.
 * See `./pointer` for the design.
 */

import type { Point } from "../geometry";
import { writeSink } from "../interact/types";
import type { PointerDriverOptions } from "./pointer";
import type { EventContext, PointerCore } from "./pointer-core";
import { detachedView } from "./pointer-core";

/** Hover, resting position and the published pointer, for one driver. */
export interface PointerPresence {
	/** The node under the pointer, as hover last settled it. */
	readonly hovered: number | null;
	/** The last move, kept so the scene moving under a still pointer re-tests. */
	resting: { device: Point; native: PointerEvent } | null;
	/** Enter/leave as a transition of the node under the pointer. */
	updateHover(
		native: PointerEvent,
		context: EventContext,
		id: number | null,
	): void;
	clearHover(native: PointerEvent, context: EventContext): void;
	/** Publishes the scene-level pointer position. */
	publish(context: EventContext, id: number | null): void;
	/** Publishes that the pointer is nowhere. */
	publishAway(): void;
	/**
	 * Re-tests the resting pointer after the view moved under it; `hover` is
	 * whether anything is hover-interested.
	 */
	retest(hover: boolean): void;
	/** Leaves the hovered node and forgets the resting pointer (driver teardown). */
	release(): void;
}

/** Builds the {@link PointerPresence} for one driver. */
export function createPointerPresence(
	core: PointerCore,
	options: Pick<PointerDriverOptions, "canvas" | "pointer">,
): PointerPresence {
	const { canvas } = options;
	let hovered: number | null = null;
	/** The item of `hovered` under the pointer (see `ScenePointerEvent.item`). */
	let hoveredItem: number | null = null;
	let resting: PointerPresence["resting"] = null;
	/** The scene point last published from the resting pointer, to skip no-op republishes. */
	let restingScene: Point | null = null;

	/**
	 * Every event that already resolved a position publishes it, including the
	 * wheel: under a camera being zoomed, a *stationary* pointer is over a
	 * different scene point after every notch, and a crosshair that only moved
	 * with the mouse would visibly lie during a zoom.
	 */
	function publish(context: EventContext, id: number | null): void {
		if (!options.pointer) return;
		restingScene = context.scene;
		writeSink(options.pointer, {
			canonical: context.canonical,
			scene: context.scene,
			id,
			camera: context.view.camera,
		});
	}

	function publishAway(): void {
		restingScene = null;
		if (options.pointer) writeSink(options.pointer, null);
	}

	function applyCursor(id: number | null): void {
		const record = core.recordFor(id);
		canvas.style.cursor = (record ? record.cursor() : null) ?? "";
	}

	/**
	 * Enter and leave, as a transition of "which node is under the pointer".
	 *
	 * There is one canvas element, so the DOM has nothing to say about crossing
	 * a shape's edge — it is a change in the hit test's answer and nothing else.
	 * Which is also why it has to be re-evaluated when the *scene* moves, not
	 * only when the pointer does.
	 */
	function updateHover(
		native: PointerEvent,
		context: EventContext,
		id: number | null,
	): void {
		const item = core.itemIn(context, id);
		if (id === hovered && item === hoveredItem) return;
		const previous = hovered;
		const previousItem = hoveredItem;
		hovered = id;
		hoveredItem = item;

		// Moving between items of one node leaves one item and enters the next,
		// but the node itself stays hovered.
		const sameNode = previous === id;
		if (previous !== null) {
			const handlers = core.handlersOf(previous);
			if (handlers?.hover && !sameNode) writeSink(handlers.hover, false);
			const leave = core.makeEvent(native, context, previous);
			// The item being left, not the one the pointer is over now.
			Object.defineProperty(leave, "item", { value: previousItem });
			handlers?.onLeave?.(leave);
		}
		if (id !== null) {
			const handlers = core.handlersOf(id);
			if (handlers?.hover && !sameNode) writeSink(handlers.hover, true);
			const enter = core.makeEvent(native, context, id);
			Object.defineProperty(enter, "item", { value: item });
			handlers?.onEnter?.(enter);
		}
		applyCursor(id);
	}

	function retest(hover: boolean): void {
		const last = resting;
		if (!last) return;
		if (!hover && !options.pointer) return;
		const view = core.viewAt(last.device);
		if (!view) return;
		const context = core.contextFor(view, last.device);
		const before = restingScene;
		const still =
			before !== null &&
			before.x === context.scene.x &&
			before.y === context.scene.y;
		if (hover) {
			const was = hovered;
			updateHover(last.native, context, core.hitIn(context));
			// Nothing new to say: the scene changed but neither the pointer's
			// place in it nor what it is over did.
			if (still && hovered === was) return;
			publish(context, hovered);
			return;
		}
		if (still) return;
		publish(context, core.hitIn(context));
	}

	function release(): void {
		// Nothing is under a pointer that is no longer listened to.
		if (hovered !== null) {
			const handlers = core.handlersOf(hovered);
			if (handlers?.hover) writeSink(handlers.hover, false);
			const last = resting;
			if (last) {
				const leave = core.makeEvent(
					last.native,
					core.contextFor(detachedView(), last.device),
					hovered,
				);
				Object.defineProperty(leave, "item", { value: hoveredItem });
				handlers?.onLeave?.(leave);
			}
			hovered = null;
			hoveredItem = null;
		}
		resting = null;
	}

	return {
		get hovered() {
			return hovered;
		},
		get resting() {
			return resting;
		},
		set resting(value) {
			resting = value;
		},
		updateHover,
		clearHover: (native, context) => updateHover(native, context, null),
		publish,
		publishAway,
		retest,
		release,
	};
}
