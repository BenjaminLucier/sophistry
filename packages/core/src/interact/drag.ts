/**
 * `draggable`: a gesture turned into a write to the track the shape reads, so a
 * draggable value is always controlled.
 *
 * `DragParam<T>` projects the pointer onto what is dragged (a point, number,
 * angle or path position), and constraints clamp before it. Every value is
 * `origin + (pointer - start)`, never accumulated deltas, so there is no drift
 * and a cancel restores exactly. The arithmetic is in `event.local`, the node's
 * own units, so dragging inside a rotated group tracks the pointer exactly.
 */

import type { Point } from "../geometry";
import type { Readable } from "../reactive";
import { isReadable } from "../reactive";
import type { Animatable } from "../tween/target";
import type { ConstraintSpec, DragContext } from "./constrain";
import { resolveConstraint } from "./constrain";
import { pointParam } from "./param";
import { DEFAULT_SLOP } from "./slop";
import type {
	DragBehaviour,
	KeyboardBehaviour,
	PointerEvents,
	ScenePointerEvent,
} from "./types";

/**
 * The projection a drag is parameterised on: pointer → value, value → point.
 *
 * `toPoint` is not decoration. It is what lets the gesture keep its grab offset:
 * the proposed position is the value's *own* point plus the pointer's
 * displacement, so a handle picked up near its edge does not snap its centre
 * under the cursor.
 *
 * @category Interaction
 */
export interface DragParam<T> {
	/** Where the pointer is → the value. */
	toValue(at: Point, ctx: DragContext<T>): T;
	/** The value → where the thing sits, in the node's local units. */
	toPoint(value: T): Point;
}

/**
 * A flag given outright, or one that changes: a `Readable` (a `Track`, a
 * `derive`) or a getter.
 *
 * @category Interaction
 */
export type FlagSource = boolean | Readable<boolean> | (() => boolean);

/** @category Interaction */
export interface DragOptions<T> {
	/** How the pointer becomes the value. Defaults to `pointParam()`. */
	param?: DragParam<T>;
	/**
	 * One clamp, or several applied in order, on the proposed position in the
	 * node's local scene units. A name (`"free"`, `"axisX"`, `"axisY"`) or a
	 * function such as `snapToGrid(0.5)` or `onCircle(center, radius)`.
	 */
	constrain?: ConstraintSpec | ConstraintSpec[];
	/**
	 * CSS cursor while the pointer is over the node.
	 * @default `"grab"`
	 */
	cursor?: string | null;
	/**
	 * CSS cursor while a gesture is live.
	 * @default `"grabbing"`
	 */
	activeCursor?: string | null;
	/** Which part of the node answers a hit; the shape's own default (`"painted"`) if omitted. */
	pointerEvents?: PointerEvents;
	/**
	 * Declines the gesture, so it falls through to whatever is beneath
	 * (including the camera) rather than being swallowed by a dead handle.
	 * Also disables the arrow-key nudge and removes the hover cursor. Pass a
	 * `Readable` to toggle it live; a getter is read on every press and nudge
	 * but cannot tell the node to drop its hover cursor.
	 *
	 * @default false
	 */
	disabled?: FlagSource;
	/**
	 * Movement in screen pixels before a press becomes a drag; below it, release is
	 * a tap (`onTap` fires, `onDragStart`/`onDragEnd` don't). `0` starts the drag on
	 * press.
	 * @default 8
	 */
	threshold?: number;
	/**
	 * How far one arrow key moves the value, in the node's local scene units.
	 *
	 * Stated in scene units rather than pixels because that is the space the
	 * value lives in, and because a step that meant something on screen would
	 * mean something different in every camera. Defaults to 0.25: a visible
	 * move on a 16-unit scene, and small enough to aim with.
	 */
	step?: number;
	/**
	 * How far one arrow key moves the value while `Shift` is held, in the node's
	 * local scene units. Defaults to `step / 5`.
	 */
	fineStep?: number;
	/** Called once when the gesture begins (after `threshold`), with the starting value. */
	onDragStart?: (value: T, event: ScenePointerEvent) => void;
	/** Called after every move that wrote the cell, with the new value. */
	onDrag?: (value: T, event: ScenePointerEvent) => void;
	/** Fires once per started gesture. A cancelled one reports the origin back. */
	onDragEnd?: (value: T, event: ScenePointerEvent) => void;
	/**
	 * What the thing in hand is now over, on **transitions only**: the topmost
	 * node under the pointer that isn't this one, or null. See `dropTarget`.
	 */
	onDragOver?: (target: number | null, event: ScenePointerEvent) => void;
}

/**
 * What `draggable` hands back: a prop bag, for `node.update(...)` or spreading
 * into a definition's `create` props.
 *
 * `cursor` is a `Readable`, so the node binds to it: `disabled` going true
 * removes the hover cursor without anyone re-writing the prop.
 *
 * @category Interaction
 */
export interface DraggableProps {
	/** The pointer half: the node's `drag` prop. */
	drag: DragBehaviour;
	/**
	 * The same machine driven by the arrow keys. Handed back beside `drag` rather
	 * than being a separate helper because a handle that can be dragged and a
	 * handle that can be nudged are the same handle: spelling them separately
	 * would let a scene ship one without the other, which is precisely the bug.
	 */
	keyboard: KeyboardBehaviour & Required<Pick<KeyboardBehaviour, "nudge">>;
	/** The hover cursor; `undefined` while disabled or when the option is `null`. */
	readonly cursor: Readable<string | undefined>;
	/** The `pointerEvents` option, passed through. */
	readonly pointerEvents: PointerEvents | undefined;
}

function readFlag(value: FlagSource | undefined): boolean {
	if (typeof value === "function") return value();
	if (isReadable(value)) return (value as Readable<boolean>).peek();
	return value ?? false;
}

/**
 * The cursor during a gesture, written onto the element the event came from.
 *
 * The driver applies a node's cursor on *hover transitions*, and a drag holds
 * pointer capture, so no transition happens for the whole gesture and the
 * record's cursor would never be re-read. Rather than reach for the DOM, this
 * asks the event target structurally for somewhere to put a cursor string; a
 * fake event in a unit test simply has nowhere, and nothing here needs a
 * canvas to run.
 */
interface CursorHost {
	style?: { cursor?: string };
}

function cursorHost(event: ScenePointerEvent): CursorHost | null {
	const target = (event.native as { target?: unknown }).target as
		| CursorHost
		| null
		| undefined;
	return target && typeof target.style?.cursor === "string" ? target : null;
}

/**
 * Makes a node draggable by writing `cell`, the track it reads. Returns a prop
 * bag for `node.update(...)` (or spread into `create`). The value is
 * `origin + (pointer - start)` through `constrain` and `param`, in the node's
 * own units. The bag includes keyboard control (arrows nudge by `step`, Shift
 * by `fineStep`, Escape cancels), so add a `label`. A press under `threshold`
 * is a tap; a `disabled` drag falls through to what is beneath.
 *
 * @param cell - The value to read and write: normally a `trackPoint(...)` or
 * `track(...)`, or any `Animatable`. Read once at gesture start, never
 * subscribed to.
 * @param options - Projection, constraints, cursor, key steps and callbacks;
 * see {@link DragOptions}.
 * @returns A {@link DraggableProps} bag for a node.
 *
 * @example
 * ```ts
 * import { circle, createScene, draggable, trackPoint } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 8 });
 * const position = trackPoint(1, 1);
 * scene.add(
 * 	circle.create({ center: position, radius: 0.3, label: "handle", ...draggable(position) }),
 * );
 * ```
 *
 * @see {@link https://sophistry.dev/guides/interaction/#dragging}
 * @see {@link dropTarget}
 *
 * @category Interaction
 */
export function draggable<T = Point>(
	cell: Animatable<T>,
	options: DragOptions<T> = {},
): DraggableProps {
	// The default is the identity projection, which is genuinely `T = Point`;
	// the cast is the price of letting the common case skip the type argument.
	const param = options.param ?? (pointParam() as unknown as DragParam<T>);
	const constraint = resolveConstraint(options.constrain);
	const threshold = options.threshold ?? DEFAULT_SLOP;
	const step = options.step ?? 0.25;
	const fineStep = options.fineStep ?? step / 5;

	interface Gesture {
		pointerId: number;
		/** Read once, at `start`. Everything else is derived from it. */
		origin: T;
		start: Point;
		startClient: Point;
		/** Past the threshold: `onDragStart` has fired and writes are happening. */
		live: boolean;
		host: CursorHost | null;
		restoreCursor: string;
		value: T;
	}

	/** Non-null exactly while one gesture owns this behaviour. */
	let gesture: Gesture | null = null;

	function apply(live: Gesture, event: ScenePointerEvent): T {
		const pointer = event.local;
		// Re-projected rather than cached, cheaply and on purpose: `origin` is
		// fixed for the gesture, so a pure param answers the same thing every
		// time, and a param that keeps per-gesture state (`angleParam`'s radius)
		// gets to correct itself instead of being pinned to what it knew before
		// the gesture existed.
		const originPoint = param.toPoint(live.origin);
		// origin + (pointer − start). Never `value + delta`: the second form is
		// the one that drifts, and the one a cancel cannot undo exactly.
		const proposed = {
			x: originPoint.x + (pointer.x - live.start.x),
			y: originPoint.y + (pointer.y - live.start.y),
		};
		const at = constraint
			? constraint(proposed, {
					origin: originPoint,
					start: live.start,
					pointer,
					event,
				})
			: proposed;
		const value = param.toValue(at, {
			origin: live.origin,
			start: live.start,
			pointer,
			event,
		});
		live.value = value;
		cell.set(value);
		return value;
	}

	function begin(live: Gesture, event: ScenePointerEvent): void {
		live.live = true;
		const active = options.activeCursor ?? "grabbing";
		const host = active ? cursorHost(event) : null;
		if (host?.style) {
			live.host = host;
			live.restoreCursor = host.style.cursor ?? "";
			host.style.cursor = active;
		}
		options.onDragStart?.(live.origin, event);
	}

	function release(): void {
		if (gesture?.host?.style) gesture.host.style.cursor = gesture.restoreCursor;
		gesture = null;
	}

	const drag: DragBehaviour = {
		start(event) {
			// Declining rather than swallowing is the whole point of the veto: a
			// disabled handle should pan the camera, not eat the gesture. A second
			// finger landing on a handle already in hand declines for the same
			// reason: one behaviour, one gesture.
			if (readFlag(options.disabled) || gesture !== null) return false;

			// Read once: everything after is `origin + (pointer − start)`.
			const origin = cell.peek();
			const live: Gesture = {
				pointerId: event.pointerId,
				origin,
				start: event.local,
				startClient: { x: event.native.clientX, y: event.native.clientY },
				live: false,
				host: null,
				restoreCursor: "",
				value: origin,
			};
			gesture = live;
			if (threshold <= 0) {
				begin(live, event);
				// Applied at once, so a constraint that disagrees with where the
				// thing already sits (a snap, a clamp) takes effect on grab rather
				// than waiting for the first move.
				apply(live, event);
			}
			return true;
		},

		move(event) {
			const live = gesture;
			if (!live || event.pointerId !== live.pointerId) return;
			if (!live.live) {
				// Screen pixels, so the dead zone is the same size on the display at
				// any zoom: the same reasoning the driver applies to its own slop.
				const dx = event.native.clientX - live.startClient.x;
				const dy = event.native.clientY - live.startClient.y;
				if (Math.hypot(dx, dy) <= threshold) return;
				begin(live, event);
			}
			// `apply` first, unconditionally, *then* the optional callback, not
			// `options.onDrag?.(apply(live, event), event)`: optional-call syntax
			// short-circuits its arguments too, so with no `onDrag` (the common
			// case) `apply` would silently never run past the first frame.
			const value = apply(live, event);
			options.onDrag?.(value, event);
		},

		end(event, cancelled) {
			const live = gesture;
			if (!live || event.pointerId !== live.pointerId) return;
			const started = live.live;
			// A cancelled gesture is an interruption, never a decision, so the cell
			// goes back to where it was. Exact, because the origin was kept rather
			// than reconstructed from the deltas applied to it.
			const value = cancelled ? live.origin : live.value;
			if (cancelled && started) cell.set(live.origin);
			release();
			if (started) options.onDragEnd?.(value, event);
			return started;
		},
	};

	// Attached only when somebody asked. The driver skips its per-move re-pick
	// unless a drag wants the answer or the scene holds a target, and an `over`
	// that were always present would quietly switch that work back on for every
	// draggable in every scene.
	const onDragOver = options.onDragOver;
	if (onDragOver) drag.over = (event, target) => onDragOver(target, event);

	/**
	 * The synthetic event a key press stands in for: `local` is the proposed point,
	 * `canonical` and `scene` repeat it, `native` carries only Shift, and `pick`
	 * returns null.
	 */
	function keyEvent(at: Point, fine: boolean): ScenePointerEvent {
		const native = {
			shiftKey: fine,
			ctrlKey: false,
			altKey: false,
			metaKey: false,
			preventDefault: () => {},
		} as unknown as PointerEvent;
		return {
			native,
			pointerId: -1,
			canonical: at,
			scene: at,
			local: at,
			camera: -1,
			id: null,
			pick: () => null,
			stopPropagation: () => {},
		};
	}

	/**
	 * One arrow key as a complete one-shot gesture through the same `apply` a
	 * pointer move uses, so constraints hold and `onDragStart`/`onDrag`/`onDragEnd`
	 * fire.
	 */
	function nudge(delta: Point, fine: boolean): void {
		if (readFlag(options.disabled) || gesture !== null) return;
		const amount = fine ? fineStep : step;
		const origin = cell.peek();
		const from = param.toPoint(origin);
		const to = { x: from.x + delta.x * amount, y: from.y + delta.y * amount };
		const live: Gesture = {
			pointerId: -1,
			origin,
			// `start` is the value's own point, so `origin + (pointer − start)` is
			// exactly the requested offset: a nudge has no grab offset to keep.
			start: from,
			startClient: { x: 0, y: 0 },
			live: true,
			host: null,
			restoreCursor: "",
			value: origin,
		};
		const event = keyEvent(to, fine);
		options.onDragStart?.(origin, event);
		const value = apply(live, event);
		options.onDrag?.(value, event);
		options.onDragEnd?.(value, event);
	}

	const hoverCursor = (): string | undefined => {
		if (readFlag(options.disabled)) return undefined;
		return options.cursor === null ? undefined : (options.cursor ?? "grab");
	};
	const disabled = options.disabled;
	const cursor: Readable<string | undefined> = {
		peek: hoverCursor,
		// Only a `Readable` flag can announce a change; a plain flag never
		// changes, and a getter has no way to say that it did.
		subscribe: (onStale) =>
			isReadable(disabled) ? disabled.subscribe(onStale) : () => {},
	};

	return {
		drag,
		keyboard: { nudge },
		cursor,
		pointerEvents: options.pointerEvents,
	};
}
