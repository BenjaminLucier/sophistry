/**
 * The pointer driver's resolution layer: a DOM event's CSS pixels → device
 * pixels → the view it falls in → scene units, plus the hit test and the
 * `ScenePointerEvent` built from that. Stateless apart from the hit cache; the
 * gesture, hover and wheel modules (`./pointer-gestures`, `./pointer-presence`,
 * `./pointer-wheel`) all resolve through one of these. See `./pointer` for the
 * design.
 */

import type { Point } from "../geometry";
import type { Matrix } from "../geometry/transform";
import {
	applyToPoint,
	IDENTITY,
	invert,
	scaleFactorOf,
} from "../geometry/transform";
import { isYUp } from "../geometry/view-matrix";
import type { HitCache } from "../interact/hit";
import { createHitCache, hitTest, indexSpecs, itemAt } from "../interact/hit";
import { DEFAULT_SLOP } from "../interact/slop";
import type {
	InteractionHandlers,
	InteractionRecord,
	ScenePointerEvent,
} from "../interact/types";
import type { DrawSpec } from "../spec/types";
import { cameraMatrix, pickCamera } from "./camera";
import type { PointerDriverOptions } from "./pointer";

/** The camera a gesture is locked to, and what survives if it goes away. */
export interface LockedView {
	camera: number;
	/** The view matrix (scene → device) at lock time — the fallback if the camera is gone. */
	matrix: Matrix;
	/** Slop in *device* pixels; divided by the live view's scale to get scene units. */
	slopDevice: number;
}

/** A view for a pointer outside every camera: the identity, with no reach. */
export function detachedView(): LockedView {
	return { camera: -1, matrix: IDENTITY, slopDevice: 0 };
}

/** Everything one event resolved to, built once and shared by every dispatch. */
export interface EventContext {
	view: LockedView;
	canonical: Point;
	scene: Point;
	/** Hit-test reach in scene units, from the view as it is now. */
	slop: number;
	/** Whether scene `y` is up on screen in the view as it is now. */
	yUp: boolean;
	consumed: boolean;
}

/** The resolution and dispatch helpers every part of the driver shares. */
export interface PointerCore {
	/** Fat-finger radius in CSS pixels. */
	readonly slopScreen: number;
	/** The hit cache every hit test of this driver shares. */
	readonly cache: HitCache;
	devicePoint(event: { clientX: number; clientY: number }): Point;
	screenToDevice(): number;
	viewAt(device: Point): LockedView | null;
	liveMatrix(view: LockedView): Matrix;
	contextFor(view: LockedView, device: Point): EventContext;
	livePoint(view: LockedView, device: Point): Point;
	pick(
		at: Point,
		exclude?: number | null,
		slop?: number,
		yUp?: boolean,
	): number | null;
	hitIn(context: EventContext, exclude?: number | null): number | null;
	/** Which item of node `id` is under the context's point (see `ScenePointerEvent.item`). */
	itemIn(context: EventContext, id: number | null): number | null;
	recordFor(id: number | null): InteractionRecord | undefined;
	handlersOf(id: number | null): InteractionHandlers | null;
	makeEvent(
		native: PointerEvent,
		context: EventContext,
		id: number | null,
		pointerId?: number,
	): ScenePointerEvent;
}

/** Builds the {@link PointerCore} for one driver's options. */
export function createPointerCore(options: PointerDriverOptions): PointerCore {
	const { canvas, registry } = options;
	const slopScreen = options.slop ?? DEFAULT_SLOP;
	const cache: HitCache = createHitCache();

	/**
	 * CSS pixels → device pixels.
	 *
	 * Scaled by the ratio actually in force — backing store over CSS box —
	 * rather than by `devicePixelRatio` directly. In the steady state they are
	 * the same number, but a `ResizeObserver` fires after the layout it
	 * describes, so for a frame or two after a resize the canvas is a size the
	 * dpr alone does not predict, and a click in that window would land in the
	 * wrong place.
	 */
	function devicePoint(event: { clientX: number; clientY: number }): Point {
		const rect = canvas.getBoundingClientRect();
		const { width, height } = options.size.peek();
		const dpr = options.dpr?.peek() ?? 1;
		const sx = rect.width > 0 ? width / rect.width : dpr;
		const sy = rect.height > 0 ? height / rect.height : dpr;
		return {
			x: (event.clientX - rect.left) * sx,
			y: (event.clientY - rect.top) * sy,
		};
	}

	/** Device pixels per CSS pixel — what turns a screen slop into a device one. */
	function screenToDevice(): number {
		const rect = canvas.getBoundingClientRect();
		const { width } = options.size.peek();
		return rect.width > 0 ? width / rect.width : (options.dpr?.peek() ?? 1);
	}

	/**
	 * Which view a device point falls in, or null when there are cameras and it
	 * fell in none of them — a gutter between panes belongs to nobody, and
	 * answering with the scene's own view would pick shapes that are not visible
	 * there.
	 */
	function viewAt(device: Point): LockedView | null {
		const views = options.cameraViews?.peek();
		const slopDevice = slopScreen * screenToDevice();
		if (!views || views.length === 0) {
			// No cameras: the scene's own framing is the one view.
			return { camera: -1, matrix: options.canonicalView.peek(), slopDevice };
		}
		const size = options.size.peek();
		const index = pickCamera(views, device, size);
		const view = views[index];
		if (index < 0 || !view) return null;
		return {
			camera: index,
			matrix: cameraMatrix(view, size),
			slopDevice,
		};
	}

	/**
	 * The locked camera's scene → device matrix *as it is now*.
	 *
	 * The camera index is what is locked at pointerdown, not its matrix: a pan
	 * writes the very camera it is dragging, and a position read through the
	 * matrix from before the last write would make every move re-apply the
	 * whole drag so far, so the pane would accelerate under the finger. The
	 * pointerdown matrix is the fallback if the camera has since gone away.
	 */
	function liveMatrix(view: LockedView): Matrix {
		if (view.camera < 0) return options.canonicalView.peek();
		const camera = options.cameraViews?.peek()[view.camera];
		if (!camera) return view.matrix;
		return cameraMatrix(camera, options.size.peek());
	}

	function contextFor(view: LockedView, device: Point): EventContext {
		const matrix = liveMatrix(view);
		const scene = applyToPoint(invert(matrix), device);
		return {
			view,
			// One inversion per event, not per dispatch: an event delivered to a
			// node and then re-picked for a drop target must not pay for it twice.
			scene,
			canonical: applyToPoint(options.canonicalView.peek(), scene),
			slop: view.slopDevice / (scaleFactorOf(matrix) || 1),
			yUp: isYUp(matrix),
			consumed: false,
		};
	}

	/**
	 * A held pointer's position in canonical pixels, resolved at *read* time.
	 *
	 * What is kept is the device point and the locked view, not the canonical
	 * point computed when the event arrived: a camera pane that moves (the pinch
	 * itself zooms it) changes which canonical point a stationary finger is over,
	 * and a position frozen at that finger's last event would be stale for every
	 * move of the other finger. The accessors go through {@link contextFor}, so
	 * they see the camera as it is now.
	 */
	function livePoint(view: LockedView, device: Point): Point {
		return {
			get x() {
				return contextFor(view, device).canonical.x;
			},
			get y() {
				return contextFor(view, device).canonical.y;
			},
		};
	}

	function pick(
		at: Point,
		exclude: number | null = null,
		slop = 0,
		yUp = true,
	): number | null {
		return hitTest(options.snapshot.peek(), registry.candidates(), at, {
			slop,
			exclude,
			cache,
			yUp,
		});
	}

	function hitIn(context: EventContext, exclude: number | null = null) {
		return pick(context.scene, exclude, context.slop, context.yUp);
	}

	/** The snapshot indexed by id, rebuilt only when an item is asked of a new snapshot. */
	let indexed: {
		specs: readonly DrawSpec[];
		index: Map<number, DrawSpec>;
	} | null = null;

	function itemIn(context: EventContext, id: number | null): number | null {
		if (id === null) return null;
		const specs = options.snapshot.peek();
		if (indexed?.specs !== specs) indexed = { specs, index: indexSpecs(specs) };
		const spec = indexed.index.get(id);
		return spec ? itemAt(spec, context.scene, context.slop) : null;
	}

	function recordFor(id: number | null) {
		return id === null ? undefined : registry.find(id);
	}

	function handlersOf(id: number | null): InteractionHandlers | null {
		const record = recordFor(id);
		return record ? record.handlers() : null;
	}

	function makeEvent(
		native: PointerEvent,
		context: EventContext,
		id: number | null,
		pointerId = native.pointerId,
	): ScenePointerEvent {
		const record = recordFor(id);
		let item: number | null | undefined;
		return {
			native,
			pointerId,
			canonical: context.canonical,
			scene: context.scene,
			local: record
				? applyToPoint(record.toLocal(), context.scene)
				: context.scene,
			camera: context.view.camera,
			id,
			// Resolved on first read: most handlers never ask, and most nodes are
			// one item.
			get item() {
				if (item === undefined) item = itemIn(context, id);
				return item;
			},
			pick: (exclude) => hitIn(context, exclude ?? null),
			stopPropagation: () => {
				context.consumed = true;
			},
		};
	}

	return {
		slopScreen,
		cache,
		devicePoint,
		screenToDevice,
		viewAt,
		liveMatrix,
		contextFor,
		livePoint,
		pick,
		hitIn,
		itemIn,
		recordFor,
		handlersOf,
		makeEvent,
	};
}
