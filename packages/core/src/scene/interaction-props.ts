/**
 * The descriptor entries for `InteractionProps`, shared by every drawable
 * kind (shapes, text, marks, images) so they all take part in hit testing,
 * focus and the accessibility mirror on the same terms.
 *
 * Handlers (`onTap`, ...) are props of kind `"event"`: bindings forward them
 * untouched and a `Readable` is never mistaken for one. Behaviour and
 * accessibility props are values that only touch the node's interaction
 * record (`Invalidate.INTERACTION`), never its geometry, style or spec.
 */

import type { InteractionProps } from "../interact/types";
import { Invalidate } from "./context";
import type { PropDescriptor, PropsDescriptor } from "./types";

/** A handler prop: passed through to the interaction record. */
const handler: PropDescriptor<never> = Object.freeze({
	kind: "event",
	invalidates: Invalidate.INTERACTION,
});

/** A behaviour or accessibility value: only the interaction record reads it. */
const record: PropDescriptor<never> = Object.freeze({
	invalidates: Invalidate.INTERACTION,
});

/**
 * Descriptor entries for every {@link InteractionProps} key. Spread it into a
 * drawable's descriptor (`shapeProps` already does):
 *
 * ```ts
 * import { interactionProps } from "@sophistry/core";
 *
 * const props = { ...interactionProps, size: { default: 1, invalidates: Invalidate.GEOMETRY } };
 * ```
 *
 * `hover` is a sink the pointer driver *writes* (a `Track` or a function), so
 * it is of kind `"event"` too: as a value, a `Track` handed to it would be
 * read as a binding instead of being written.
 *
 * @category Interaction
 */
export const interactionProps: PropsDescriptor<InteractionProps> =
	Object.freeze({
		onPointerDown: handler,
		onPointerMove: handler,
		onPointerUp: handler,
		onTap: handler,
		onDoubleTap: handler,
		onLongPress: handler,
		onContextMenu: handler,
		onWheel: handler,
		onEnter: handler,
		onLeave: handler,
		hover: handler,
		drag: record,
		keyboard: record,
		drop: record,
		itemLabel: record,
		pointerEvents: { default: "painted", invalidates: Invalidate.INTERACTION },
		hitArea: record,
		cursor: record,
		label: record,
		role: { default: "button", invalidates: Invalidate.INTERACTION },
		pressed: record,
		focusable: record,
	});
