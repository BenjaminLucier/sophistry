/**
 * The interaction vocabulary: what a gesture is, and how a node wants to be hit.
 * Every interaction is a value writer (a shape is its props), and a value a
 * gesture writes is a `Sink`: an `Animatable<T>` (`peek` + `set`, the only
 * type imported from `tween/`) or a plain setter.
 */

import type { Bounds, Point, Polyline } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import type { Animatable } from "../tween/target.js";

import type { HitCache } from "./hit.js";

/**
 * Somewhere a gesture can write a value: an `Animatable<T>` (a `Track<T>`, or
 * a `lensTarget` / `propTarget` / `storeTarget` over your own state) or a
 * plain setter function.
 *
 * @category Interaction
 */
export type Sink<T> = Animatable<T> | ((value: T) => void);

/**
 * Writes to a `Sink` whichever of the two shapes it turned out to be.
 *
 * @category Interaction plumbing
 */
export function writeSink<T>(sink: Sink<T>, value: T): void {
	// `.set` first, not `typeof sink === "function"`: a sink may be a function
	// with `.set` attached (a framework accessor dressed up as a target), and
	// calling it as if it were the setter would read rather than write. The
	// property is the reliable test, checked before the call.
	if (
		(typeof sink === "object" || typeof sink === "function") &&
		sink !== null &&
		"set" in sink
	) {
		sink.set(value);
	} else {
		(sink as (value: T) => void)(value);
	}
}

/**
 * Which part of a node answers a hit, with SVG's meaning: `"painted"` (the drawn
 * fill and stroke; the default), `"bounds"` (the bounding box, good for
 * hairlines and text), `"all"` (the enclosed region, filled or not) or `"none"`.
 *
 * @category Interaction
 */
export type PointerEvents = "none" | "painted" | "bounds" | "all";

/**
 * An explicit hit region replacing the node's own geometry, in the node's
 * **local scene units** — the same units its `x`/`y` are in. The registry maps
 * it into scene units before `hit.ts` ever sees it, so a hit area rides
 * every enclosing `<Group>` exactly as the geometry it stands in for does.
 *
 * @category Interaction
 */
export type HitArea = Bounds | Polyline;

/**
 * One pointer gesture in three spaces: `canonical` stage pixels (independent of
 * camera zoom, for gesture maths), `scene` units (to compare with geometry), and
 * `local` units of the target (to write its own props).
 *
 * @category Interaction
 */
export interface ScenePointerEvent {
	/** The DOM event, for `preventDefault` and the modifier keys. */
	native: PointerEvent;
	/** The browser's pointer id; `-1` for a synthesised keyboard activation. */
	pointerId: number;
	/**
	 * Pointer in the stage's *own-framing* pixels: where the stage's
	 * `units`/`center`/`yUp` view puts it, whichever camera the gesture is in
	 * (device pixels on a plain `<Stage>`). A camera-independent screen-ish
	 * space for gesture maths — a pinch's finger distance, an orbit drag's
	 * delta. Specs are *not* in this space (they are in scene units), so do not
	 * compare it against geometry; use `scene` for that.
	 */
	canonical: Point;
	/** Pointer in the stage's scene units. */
	scene: Point;
	/**
	 * Pointer in the target node's own local units. Equal to `scene` for a node
	 * that sits directly under `<SceneSpace>`; through a rotated or scaled
	 * `<Group>` it is the exact preimage, not the stage-unit approximation
	 * `scene/core/layout.ts` settles for.
	 */
	local: Point;
	/**
	 * Index into the camera list of the view this gesture is locked to, or `-1`
	 * on a plain `<Stage>`.
	 *
	 * *Locked*, not "current": a drag that begins in a zoomed inset and wanders
	 * into the main view keeps the inset's mapping for its whole life, because
	 * changing the mapping mid-gesture would teleport whatever is being dragged.
	 */
	camera: number;
	/** The node this event was delivered to, or `null` for a background gesture. */
	id: number | null;
	/**
	 * Which item of a batched node (a dense `Scatter`'s marker, an image's pixel
	 * as `row * width + column`) the pointer is on; absent or `null` for a node
	 * that is one item. Hover treats each item as its own target: moving from one
	 * marker to the next leaves the first and enters the second, both on the
	 * same node id.
	 */
	item?: number | null;
	/**
	 * Re-runs the hit test at this event's position, optionally ignoring a node.
	 *
	 * What a drop target is built from: during a drag, `pick(event.id)` is the
	 * topmost thing under the pointer that isn't the thing in your hand.
	 */
	pick(exclude?: number | null): number | null;
	/**
	 * Stops the driver treating this gesture as background — i.e. declines to
	 * let it become a camera pan. Implied by any node handler that runs.
	 */
	stopPropagation(): void;
}

/**
 * A wheel over a node that takes wheels (`onWheel`), in the same spaces as a
 * {@link ScenePointerEvent}.
 *
 * @category Interaction
 */
export interface SceneNodeWheelEvent {
	/** The DOM event, for its deltas, `deltaMode` and modifier keys. */
	native: WheelEvent;
	/** Cursor in the stage's own-framing pixels (see {@link ScenePointerEvent.canonical}). */
	canonical: Point;
	/** Cursor in the stage's scene units. */
	scene: Point;
	/** Cursor in the node's own local units. */
	local: Point;
	/** Index of the camera under the cursor, or `-1` on a plain `<Stage>`. */
	camera: number;
	/** The node this wheel was delivered to. */
	id: number;
	/**
	 * Scene units per CSS pixel of screen movement, per axis and signed (the y
	 * flip included) — what turns a wheel's deltas into a scene distance.
	 */
	unitsPerPixel: Point;
}

/**
 * A drag as the pointer driver sees it: three calls and a veto. The driver owns
 * capture, the camera lock, the threshold and cleanup; the behaviour owns what
 * the gesture means.
 *
 * @category Interaction
 */
export interface DragBehaviour {
	/**
	 * Called on pointerdown over the node. Return `false` to decline — the
	 * gesture then falls through to whatever is beneath, including the camera.
	 */
	start(event: ScenePointerEvent): boolean;
	move(event: ScenePointerEvent): void;
	/**
	 * `cancelled` is true for a lost capture or an interrupted gesture.
	 *
	 * Return `false` when the press was claimed but never became a drag (it
	 * never crossed the behaviour's threshold); the driver then treats the
	 * release as an ordinary press, so `onTap` still fires.
	 */
	// biome-ignore lint/suspicious/noConfusingVoidType: implementers that never fall through return nothing
	end(event: ScenePointerEvent, cancelled: boolean): boolean | void;
	/**
	 * What the thing in hand is now over — `event.pick(event.id)`, resolved by
	 * the driver and pushed here on **transitions only**, never per move.
	 *
	 * The id is the topmost node under the pointer whether or not it declares a
	 * `drop`, because "am I over the right thing?" is a question about the scene
	 * rather than about who volunteered to answer it.
	 */
	over?(event: ScenePointerEvent, target: number | null): void;
}

/**
 * The keyboard half of a behaviour. A nudge goes through the behaviour (so a
 * constrained handle stays constrained under the arrow keys) rather than writing
 * the value directly.
 *
 * @category Accessibility
 */
export interface KeyboardBehaviour {
	/**
	 * Moves the value one step. `delta` is a **direction in the node's own local
	 * units** — the caller has already mapped the arrow key's screen direction
	 * through the node's inverse matrix, so `ArrowRight` moves the handle right
	 * on screen even inside a rotated `<Group>`. How long a step is belongs to
	 * the behaviour; `fine` asks for the small one. Omitted, the arrow keys do
	 * nothing and are not advertised.
	 */
	nudge?(delta: Point, fine: boolean): void;
	/**
	 * Enter/Space, when the node wants something other than its `onTap`. Rarely
	 * needed: activation falls back to `onTap`, which is the point of having it.
	 */
	activate?(): void;
	/**
	 * Any other key pressed on the focused node — `+`/`-` on a zoomable plot,
	 * Escape to climb out of a drill-down. Called first, before the arrow and
	 * activation keys are mapped; Escape arrives only when it did not cancel a
	 * drag in flight. Return `true` when the key was handled: the accessibility
	 * layer then prevents its default and stops mapping it.
	 */
	key?(event: KeyboardEvent): boolean;
	/**
	 * The keys `key` answers, as `aria-keyshortcuts` lists them (`"+ - Escape"`),
	 * so assistive technology can announce them. Added to the arrow keys when
	 * `nudge` is present.
	 */
	shortcuts?: string;
}

/**
 * A node that can be dropped onto. `enter` and `leave` fire on transitions,
 * like hover, and `drop` on release over it.
 *
 * @category Interaction
 */
export interface DropTarget {
	/**
	 * Declines a particular dragged node — a slot that only takes one kind of
	 * thing. A declined target still *blocks*: nothing beneath it is offered the
	 * drop, because on screen it is plainly the thing under the pointer.
	 */
	accepts?(dragged: number): boolean;
	enter?(event: ScenePointerEvent, dragged: number): void;
	leave?(event: ScenePointerEvent, dragged: number): void;
	/** Fires before `leave`, and only for a gesture that was not cancelled. */
	drop?(event: ScenePointerEvent, dragged: number): void;
	/** Written `true` while something is over this target — hover's spelling. */
	over?: Sink<boolean>;
}

/**
 * What a node tells the driver about itself. Every field is a getter, read
 * when the driver needs it, so a node can stop being draggable, change its
 * cursor or grow its hit area without re-registering.
 *
 * @category Interaction plumbing
 */
export interface InteractionRecord {
	/** The scene node id this belongs to — the same counter, so the two agree. */
	id: number;
	/** Local units → the stage's scene units: the node's own space matrix. */
	toScene: () => Matrix;
	/** The stage's scene units → local units. The inverse, memoised. */
	toLocal: () => Matrix;
	pointerEvents: () => PointerEvents;
	/** Overrides the node's geometry as the hit region. Local scene units. */
	hitArea: () => HitArea | null;
	/** CSS cursor while the pointer is over this node, or null to leave it be. */
	cursor: () => string | null;
	handlers: () => InteractionHandlers;
	/** The accessible name, or null for a node that never said one. */
	label: () => string | null;
	/** ARIA role for this node's DOM mirror. Null lets the mirror choose. */
	role: () => string | null;
	/**
	 * A toggle's state, for the mirror's `aria-pressed`; null (or absent, on a
	 * record built by hand) for a node that is not a toggle.
	 */
	pressed?: () => boolean | null;
	/**
	 * Whether this node is a tab stop. See `isFocusable`, which is where the
	 * default is decided; `false` here is an explicit opt-out.
	 */
	focusable: () => boolean | undefined;
	/**
	 * The id of the record that owns focus for this node's interaction group
	 * (its first registered member), or null outside one. A group is one tab stop.
	 */
	focusOwner: () => number | null;
}

/**
 * Whether a node is a tab stop: by default when it can be activated (`onTap`, a
 * drag or keyboard behaviour), not for `hover` alone; `focusable` overrides.
 *
 * @category Interaction plumbing
 */
export function isFocusable(record: InteractionRecord): boolean {
	const explicit = record.focusable();
	if (explicit !== undefined) return explicit;
	// Inside a group, only the elected owner is a stop — the others are the same
	// thing wearing a different node id.
	const owner = record.focusOwner();
	if (owner !== null && owner !== record.id) return false;
	const handlers = record.handlers();
	return (
		handlers.onTap !== undefined ||
		handlers.drag !== undefined ||
		handlers.keyboard !== undefined
	);
}

/**
 * The handlers a node registers. All optional; a node with none of them is not
 * registered at all, which is what keeps the candidate set small enough that
 * hit testing is a walk over a handful of records rather than over the scene.
 *
 * @category Interaction
 */
export interface InteractionHandlers {
	/** A pointer went down on this node. Claims the gesture, so it no longer pans a camera. */
	onPointerDown?: (event: ScenePointerEvent) => void;
	/** The pointer moved while a press that began on this node is still down. */
	onPointerMove?: (event: ScenePointerEvent) => void;
	/** The press that began on this node ended (not called for a cancelled drag). */
	onPointerUp?: (event: ScenePointerEvent) => void;
	/**
	 * A completed tap or click: same node down and up, within the movement slop
	 * and the time limit. Distinct from `onPointerUp`, which fires whether or
	 * not the pointer wandered.
	 */
	onTap?: (event: ScenePointerEvent) => void;
	/** A second tap on the same node within 300 ms of the first (by default). Also fires `onTap` first. */
	onDoubleTap?: (event: ScenePointerEvent) => void;
	/** Touch's right-click. Fires while the pointer is still down, after 500 ms by default without moving. */
	onLongPress?: (event: ScenePointerEvent) => void;
	/** The browser's context menu (right-click, or its long-press equivalent) over this node. */
	onContextMenu?: (event: ScenePointerEvent) => void;
	/**
	 * A wheel (or trackpad pinch) over this node. The wheel goes to the topmost
	 * node under the cursor that has `onWheel` — nodes without one are
	 * transparent to it — and a node that takes it claims it: the page does not
	 * scroll and the stage's own wheel listeners (`<PanZoom>`,
	 * `<OrbitControls3D>`) never see it. Return `false` to decline, and the
	 * wheel goes on to the next such node beneath, then to the stage.
	 */
	// biome-ignore lint/suspicious/noConfusingVoidType: a handler that always takes the wheel returns nothing
	onWheel?: (event: SceneNodeWheelEvent) => boolean | void;
	/** The pointer moved onto this node. Hover-only: touch never fires it. */
	onEnter?: (event: ScenePointerEvent) => void;
	/** The pointer left this node. */
	onLeave?: (event: ScenePointerEvent) => void;
	/**
	 * Written `true` on enter and `false` on leave — the whole of hover.
	 *
	 * There is deliberately no tooltip here. Hover is a boolean; what is drawn
	 * while it holds is scene code, and the scene already has everything it
	 * needs to draw it. Note that touch has no hover state at all, so anything
	 * behind this alone is invisible on a phone: give it a tap route too.
	 */
	hover?: Sink<boolean>;
	/** Pointer drag behaviour. Normally the `drag` of a `draggable()` bag. */
	drag?: DragBehaviour;
	/** Arrow-key and activation behaviour. `draggable()` returns one. */
	keyboard?: KeyboardBehaviour;
	/** Makes this node a target for whatever is being dragged over it. */
	drop?: DropTarget;
	/**
	 * For a batched node (see `ScenePointerEvent.item`): an item's accessible
	 * description. Given it, the node's accessibility element is a list of its
	 * items rather than one button — the arrow keys walk a current item (hover
	 * events and the focus ring follow it), Enter or Space taps it, and a
	 * screen reader announces this text with the item's place in the list.
	 */
	itemLabel?: (item: number) => string | undefined;
}

/**
 * Everything the driver needs in order to test one node.
 *
 * @category Interaction plumbing
 */
export interface HitCandidate {
	/** The node's scene id. */
	id: number;
	/** Which part of the node answers a hit. */
	pointerEvents: PointerEvents;
	/** Already in scene units — the registry did the conversion. */
	hitArea: HitArea | null;
}

/** @category Interaction plumbing */
export interface HitOptions {
	/**
	 * Tolerance added to every stroke's half-width, in scene units.
	 *
	 * Callers pass a *screen*-pixel figure divided by the camera's scale, so a
	 * fat-finger radius stays the same size on the display whatever the zoom.
	 * A hairline in a zoomed-out pane is otherwise untappable.
	 */
	slop?: number;
	/**
	 * Whether scene `y` increases upward on screen in the view the point came
	 * through. Only text needs it (a text run's box hangs off its anchor in the
	 * direction that is up *on screen*). Defaults to true.
	 */
	yUp?: boolean;
	/** Ignore this node — during a drag, the thing already in hand. */
	exclude?: number | null;
	/**
	 * Only these nodes can be hit; the rest are transparent to this test. How a
	 * wheel finds the topmost node that takes wheels, through marks that don't.
	 */
	accept?: (id: number) => boolean;
	/**
	 * Bounding-box memo for the AABB pre-pass. Owned by the caller rather than
	 * by the module, so two stages on one page never share one.
	 */
	cache?: HitCache;
}

/**
 * Interaction props every shape and `<Label>` accepts. Any handler makes a node
 * hit-testable; one that can be activated (`onTap`, a drag or keyboard
 * behaviour) is also a tab stop, where Enter or Space calls `onTap`. Hover has no
 * touch equivalent, so back it with a tap route.
 *
 * @see {@link https://sophistry.dev/guides/interaction/}
 * @category Interaction
 */
export interface InteractionProps extends InteractionHandlers {
	/**
	 * Which part of the node answers a hit.
	 * @default `"painted"`
	 */
	pointerEvents?: PointerEvents;
	/** An explicit hit region in this node's local scene units, replacing its drawn geometry. */
	hitArea?: HitArea;
	/** CSS cursor (such as `"pointer"`) while the pointer is over this node. */
	cursor?: string;
	/**
	 * The accessible name — what a screen reader says when focus lands here.
	 *
	 * A canvas has no text for AT to read, so this is the *only* thing a node
	 * can be announced as. An interactive node without one is still a tab stop,
	 * and still announces something ("button"), which is why leaving it out is a
	 * bug rather than a default.
	 */
	label?: string;
	/**
	 * ARIA role for the DOM mirror.
	 * @default `"button"`
	 */
	role?: string;
	/**
	 * Makes the node a toggle button for assistive technology: its mirror
	 * reports `aria-pressed` with this state (a mode in a toolbar, a series
	 * shown or hidden). Omitted, the node is not a toggle.
	 */
	pressed?: boolean;
	/** Forces this node into or out of the tab order. See `isFocusable`. */
	focusable?: boolean;
}

/**
 * True when a node asked for anything interactive; registration is skipped
 * otherwise.
 *
 * @category Interaction plumbing
 */
export function hasInteraction(props: InteractionProps): boolean {
	return (
		props.pointerEvents !== undefined ||
		props.hitArea !== undefined ||
		props.cursor !== undefined ||
		props.onPointerDown !== undefined ||
		props.onPointerMove !== undefined ||
		props.onPointerUp !== undefined ||
		props.onTap !== undefined ||
		props.onDoubleTap !== undefined ||
		props.onLongPress !== undefined ||
		props.onContextMenu !== undefined ||
		props.onWheel !== undefined ||
		props.onEnter !== undefined ||
		props.onLeave !== undefined ||
		props.hover !== undefined ||
		props.drag !== undefined ||
		props.keyboard !== undefined ||
		props.drop !== undefined ||
		props.itemLabel !== undefined ||
		props.label !== undefined ||
		props.role !== undefined ||
		props.pressed !== undefined ||
		props.focusable !== undefined
	);
}
