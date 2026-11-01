/**
 * `createScene`: a scene graph plus the canvas it paints into. It owns the canvas and its sizing, the renderer
 * and its place in the shared frame loop, the scene's framing (`units`,
 * `center`, `yUp`), theme and background, its clock and reduced-motion
 * setting, and its cameras. A scene with no camera is a scene with one
 * implicit view; the renderer and pointer driver treat an empty camera list
 * exactly like an omitted one.
 *
 * Per frame of the shared loop (`tween/frame-loop.ts`):
 *
 * 1. tick: clocks advance, animations write tracks (which only mark);
 * 2. commit: the scene pushes any changed framing, theme, size or cameras
 *    into the renderer and the root's context, then the graph commits its
 *    dirty nodes and hands a changed frame to `renderer.setFrame`;
 * 3. paint: the renderer paints if anything changed (a passive participant,
 *    so a scene with nothing dirty costs one boolean check in frames other
 *    things caused, and causes none itself).
 *
 * Without a host or canvas (or with `headless: true`) a scene touches no DOM:
 * the graph commits as usual (in the frame loop, or by `scene.commit()`), the
 * frame and size come from options, and nothing is painted. For tests and
 * server rendering.
 */

import type { Animation } from "../anim/animation.js";
import type { PlayContext, PlayResult, Timeline } from "../anim/timeline.js";
import {
	anySignal,
	timeline as createTimeline,
	play as playAnimations,
	splitPlayArguments,
} from "../anim/timeline.js";
import type { ColorInput } from "../color/index.js";
import { cssColor } from "../color/index.js";
import type { Bounds, Point } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import { viewMatrix } from "../geometry/view-matrix.js";
import type { ScenePointer } from "../interact/pointer.js";
import { createPointerChannel } from "../interact/pointer.js";
import type {
	FocusChannel,
	InteractionRegistry,
} from "../interact/registry.js";
import type { Readable } from "../reactive/index.js";
import { derive, isReadable, track } from "../reactive/index.js";
import type { FocusItem } from "../render/a11y.js";
import { createAccessibilityMirror, focusIds } from "../render/a11y.js";
import type { CameraDefaults, CameraView } from "../render/camera.js";
import type { Renderer } from "../render/canvas-renderer.js";
import { createCanvasRenderer } from "../render/canvas-renderer.js";
import type { PointerDriver } from "../render/pointer.js";
import { createPointerDriver } from "../render/pointer.js";
import type { DrawSpec } from "../spec/types.js";
import { colorModeReadable } from "../themes/mode.js";
import type { ThemeSpec } from "../themes/theme.js";
import { resolveTheme } from "../themes/theme.js";
import type { Theme } from "../themes/types.js";
import type {
	Clock,
	ReducedMotionTransition,
	VisibilityHandle,
} from "../tween/clock.js";
import { defaultClock, watchClockVisibility } from "../tween/clock.js";
import {
	currentFramePhase,
	onFrame,
	requestFrame,
} from "../tween/frame-loop.js";
import type { ReducedMotion } from "../tween/reduced-motion.js";
import { prefersReducedMotion } from "../tween/reduced-motion.js";
import type { Camera, CameraOptions } from "./cameras.js";
import { createCameraList } from "./cameras.js";
import {
	clockContext,
	frameContext,
	pointerContext,
	reducedMotionContext,
	themeContext,
} from "./context.js";
import { SceneGraph } from "./graph.js";
import {
	createFocusChannel,
	createInteractionRegistry,
} from "./interaction.js";
import type { ContainerNode, SceneNode } from "./types.js";

/** Browsers refuse canvases past 16384 px per side (and 268M px² in area). */
const MAX_CANVAS_SIDE = 16384;
const clampSide = (px: number) =>
	Math.min(MAX_CANVAS_SIDE, Math.max(1, Math.round(px)));
/** Length of a reduced-motion dissolve, in seconds: the audit's ≤ 150 ms. */
const REDUCED_MOTION_FADE = 0.15;
/**
 * Classes of the box a scene creates inside its `host`, unless `class`
 * replaces them. Exported (through `./internal`) for the bindings, which
 * restore it when their `boxClass` prop is removed.
 *
 * @internal
 */
export const DEFAULT_CLASS = "w-full overflow-hidden rounded-xl";

/**
 * What a scene's canvas is filled with before the scene paints: `"theme"`
 * (the palette background), `"transparent"` (so the page shows through and
 * exported PNGs keep alpha), or any colour.
 *
 * @category Stage & cameras
 */
export type SceneBackground = "theme" | "transparent" | ColorInput;

/**
 * A canvas size, in device pixels.
 *
 * @category Stage & cameras
 */
export interface SceneSize {
	width: number;
	height: number;
}

/**
 * The framing `scene.setView(...)` changes. A `Readable` binds, so a
 * `track()` for `units` animates a zoom and one for `center` pans.
 *
 * @category Stage & cameras
 */
export interface SceneView {
	/** Scene units spanning the canvas width. */
	units?: number | Readable<number>;
	/** The scene point at the middle of the canvas. */
	center?: Point | Readable<Point>;
	/** Whether scene `y` runs up the screen. */
	yUp?: boolean;
}

/**
 * Options for {@link createScene}.
 *
 * @category Stage & cameras
 */
export interface SceneOptions {
	/**
	 * The element to mount into. The scene creates a box inside it (as wide
	 * as `host`, its height from `aspect`, `position: relative` for the
	 * accessibility mirror, `overflow: hidden`) holding a canvas pinned to the
	 * box. The box is `scene.element`; disposing the scene removes it.
	 */
	host?: HTMLElement;
	/**
	 * A canvas to paint into instead of creating one. Its parent element is
	 * observed and measured (the canvas itself when it has none); its CSS
	 * width and height are pinned to 100% unless already set inline, since a
	 * canvas laid out at its backing-store size would grow its parent on every
	 * measurement. Wins over `host`.
	 */
	canvas?: HTMLCanvasElement;
	/**
	 * Build the scene without any DOM: no canvas, no renderer, no observers.
	 * Implied when neither `host` nor `canvas` is given.
	 *
	 * @default false
	 */
	headless?: boolean;
	/**
	 * The canvas size of a headless scene, in device pixels; it only decides
	 * the visible `frame`'s height. Ignored with a canvas, which is measured.
	 * Defaults to no size, where the frame's height follows `aspect`.
	 */
	size?: SceneSize;
	/**
	 * How many scene units span the full width. Larger values zoom out. The
	 * visible height follows from the canvas's aspect ratio (9 at the
	 * defaults). A `Readable` binds, so a `track()` zooms.
	 *
	 * @default 16
	 */
	units?: number | Readable<number>;
	/**
	 * The scene point shown at the middle of the canvas, in scene units. A
	 * `Readable` binds, so a moving point pans the view.
	 *
	 * @default { x: 0, y: 0 }
	 */
	center?: Point | Readable<Point>;
	/**
	 * Maths convention: `y` increases upward on screen. Pass `false` for the
	 * canvas convention (`y` increases downward).
	 *
	 * @default true
	 */
	yUp?: boolean;
	/**
	 * Width divided by height of the box the scene creates in `host` (the CSS
	 * `aspect-ratio`), and of a headless scene without a `size`. The scene is
	 * not stretched, because `units` always maps to the width.
	 *
	 * @default 16 / 9
	 */
	aspect?: number;
	/**
	 * A fully-built theme, used as-is; wins over `palette` and `mode`. See
	 * `resolveTheme`.
	 */
	theme?: Theme;
	/** A built-in palette name or a palette object; defaults to Catppuccin. */
	palette?: ThemeSpec["palette"];
	/**
	 * Which variant of the palette to paint. Defaults to the page's current
	 * mode, followed live (`colorModeReadable`), so the scene tracks light and
	 * dark on its own.
	 */
	mode?: ThemeSpec["mode"];
	/**
	 * What the canvas is filled with before the scene paints. Cameras inherit it.
	 *
	 * @default "theme"
	 */
	background?: SceneBackground;
	/**
	 * The clock scene scripts run on (`scene.play`, `scene.timeline`, and
	 * nodes reading `clockContext`). Defaults to the shared `defaultClock`;
	 * give each scene its own `createClock()` when several need independent
	 * pause and speed. A clock of its own is suspended while the scene is
	 * off-screen (see `pauseWhenHidden`); `defaultClock` never is, being shared.
	 */
	clock?: Clock;
	/**
	 * Reduced-motion mode for runs started through `scene.play` and
	 * `scene.timeline`: `"auto"` follows `prefers-reduced-motion`, `"reduce"`
	 * and `"no-preference"` force it. When omitted the scene defers to its clock.
	 */
	reducedMotion?: ReducedMotion;
	/**
	 * How a reduced-motion jump looks: `"fade"` cross-fades the canvas over
	 * 150 ms, `"cut"` shows the new picture at once. Paint-only; tracks land
	 * immediately either way.
	 *
	 * @default "fade"
	 */
	reducedMotionTransition?: ReducedMotionTransition;
	/**
	 * Skip painting, and suspend the scene's own `clock`, while scrolled out
	 * of view. Needs `IntersectionObserver`.
	 *
	 * @default true
	 */
	pauseWhenHidden?: boolean;
	/**
	 * CSS classes for the box created in `host`. Replaces the default rather
	 * than adding to it; width, aspect ratio, position and `overflow: hidden`
	 * are applied inline either way.
	 *
	 * @default "w-full overflow-hidden rounded-xl"
	 */
	class?: string;
}

/**
 * A scene: a retained tree of nodes painted into one canvas, viewed through
 * zero or more cameras. Made by {@link createScene}.
 *
 * @category Stage & cameras
 */
export interface Scene {
	/** The root container; add the scene's nodes to it (or use {@link Scene.add}). */
	readonly root: ContainerNode;
	/** The clock scene scripts run on. */
	readonly clock: Clock;
	/** The canvas painted into, or null for a headless scene. */
	readonly canvas: HTMLCanvasElement | null;
	/**
	 * The box the canvas sits in: the one created inside `host`, or the given
	 * canvas's parent. What is measured and observed, and where the
	 * accessibility mirror goes. Null for a headless scene.
	 */
	readonly element: HTMLElement | null;
	/** Whether the scene has no DOM (see {@link SceneOptions.headless}). */
	readonly headless: boolean;
	/**
	 * The visible box in scene units: `units` wide, centred on `center`, as
	 * tall as the canvas's aspect ratio makes it. Also provided to every node
	 * as `frameContext` (what `toEdge`/`toCorner` pin against).
	 */
	readonly frame: Readable<Bounds>;
	/** The canvas backing-store size in device pixels (the host box times `devicePixelRatio`). */
	readonly size: Readable<SceneSize>;
	/** Device pixels per CSS pixel. 1 for a headless scene. */
	readonly dpr: Readable<number>;
	/**
	 * The active theme, also provided to every node as `themeContext`. Follows
	 * the page's colour mode while the scene uses the default theme (no
	 * `theme` and no `mode`).
	 */
	readonly theme: Readable<Theme>;
	/** The canvas fill as a CSS colour, or null for a transparent scene. */
	readonly background: Readable<string | null>;
	/**
	 * Whether runs on this scene reduce motion: the `reducedMotion` option,
	 * else the clock's setting. Provided to nodes as `reducedMotionContext`.
	 */
	readonly reducedMotion: Readable<boolean>;
	/**
	 * The scene's own view matrix (scene units to device pixels) for its
	 * framing and canvas size: what the canvas is painted under when there are
	 * no cameras, and what defines the "canonical" pixels pointer events
	 * report. No node reads it, so zoom, pan and resize repaint the same specs.
	 */
	readonly canonicalView: Readable<Matrix>;
	/**
	 * The cameras' resolved views, in paint (creation) order; empty for a
	 * scene with no cameras. Keeps its identity while no view changed.
	 */
	readonly cameraViews: Readable<readonly CameraView[]>;
	/**
	 * Where the pointer is over the canvas, in scene units through the camera
	 * it is over (and in the scene's own-framing pixels), with the topmost
	 * interactive node under it; null while no pointer is over the canvas, and
	 * always for a headless scene. Updates on every move, hover included, and
	 * when the view moves under a still pointer. For crosshairs, readouts and
	 * brushes; a node's own gestures arrive as its events instead.
	 */
	readonly pointer: Readable<ScenePointer | null>;
	/**
	 * The focused node: `state` is its id (or null) and what moved it
	 * (`"keyboard"` shows a ring, `"pointer"` does not); `set` moves focus from
	 * script, which also moves the browser's focus to the node's accessibility
	 * element.
	 */
	readonly focus: FocusChannel;
	/** Adds `node` to the root and returns it. */
	add<N extends SceneNode>(node: N): N;
	/**
	 * Changes the framing. A change of `units` or `center` is a new view
	 * matrix: the same specs repaint, nothing in the scene recomputes (except
	 * nodes bound to `frame`). A `Readable` binds; a plain value unbinds.
	 */
	setView(view: SceneView): void;
	/**
	 * Changes the theme, with the same rules as the options: `theme` wins,
	 * else `palette` in `mode`, else in the page's mode, followed live.
	 */
	setTheme(spec: ThemeSpec): void;
	/** Changes what the canvas is filled with before the scene paints. */
	setBackground(background: SceneBackground): void;
	/**
	 * Adds a camera, painted after (over) the existing ones. See
	 * `splitScreen`, `pictureInPicture` and `quadView` for common layouts.
	 */
	addCamera(options?: CameraOptions): Camera;
	/**
	 * Runs animations in parallel on the scene's clock and resolves when the
	 * longest finishes, honouring the scene's reduced motion (a reduced run
	 * jumps to its end, shown with the scene's `reducedMotionTransition`).
	 * Disposing the scene aborts the run. A trailing `PlayContext` overrides
	 * any of those.
	 */
	play(
		...args: Animation[] | [...Animation[], PlayContext]
	): Promise<PlayResult>;
	/**
	 * A seekable timeline on the scene's clock, with the scene's reduced
	 * motion and lifetime, as {@link Scene.play}.
	 */
	timeline(animation: Animation, context?: PlayContext): Timeline;
	/**
	 * Brings the scene up to date now (framing, theme, cameras, then the
	 * graph's dirty nodes) instead of waiting for the frame's commit phase.
	 * Returns whether the frame changed. Does not paint.
	 */
	commit(): boolean;
	/**
	 * The z-sorted specs the next paint draws (the renderer's snapshot), or
	 * the graph's last frame for a headless scene.
	 */
	snapshot(): readonly DrawSpec[];
	/**
	 * Aborts the scene's runs, disconnects its observers, leaves the frame
	 * loop, disposes the renderer and every node, and removes the box it
	 * created. Idempotent.
	 */
	dispose(): void;
}

/**
 * What the interaction layer (pointer driver, accessibility mirror,
 * `PanZoom`) needs from a scene beyond its public surface. Kept off the
 * interface; read with {@link sceneInternals}.
 *
 * @internal
 */
export interface SceneInternals {
	/** The commit engine: `interactive`, `onInteractionChange`, `onStructureChange`, `ordered`. */
	readonly graph: SceneGraph;
	/**
	 * The renderer (`snapshot` for picking, `setFocus`/`setFocusItem` for
	 * the ring), or null for a headless scene.
	 */
	readonly renderer: Renderer | null;
	/**
	 * Runs `cleanup` when the scene is disposed, before the renderer and the
	 * graph go (so a driver can still read them while it detaches). Runs at
	 * once if the scene is already disposed.
	 */
	onDispose(cleanup: () => void): void;
	/** The interactive nodes, in tree order (`scene/interaction.ts`). */
	readonly registry: InteractionRegistry;
	/** The focused node (the same channel as `scene.focus`). */
	readonly focus: FocusChannel;
	/** The pointer driver, or null for a headless scene. */
	readonly driver: PointerDriver | null;
	/** The renderer's snapshot as a `Readable`: stale whenever a new frame is handed over. */
	readonly snapshot: Readable<readonly DrawSpec[]>;
	/** Sets the item the focus ring wraps within a focused batched node (`renderer.setFocusItem`). */
	setFocusItem(item: FocusItem | null): void;
}

const internals = new WeakMap<Scene, SceneInternals>();

/**
 * The {@link SceneInternals} of a scene made by {@link createScene}.
 *
 * @internal
 */
export function sceneInternals(scene: Scene): SceneInternals | undefined {
	return internals.get(scene);
}

/**
 * The pointer driver of a scene made by {@link createScene}: the handle
 * camera controllers (`panZoom`, `orbitControls3D`) subscribe their gestures
 * through (`onBackground`, `onWheel`, `claimTouch`, `pointers`, `toScene`).
 * Most scene code never needs it; use node props (`onTap`, `drag`) or
 * `node.on(...)` instead. Wire your own camera controller to it with
 * `subscribeCameraGesture` from `@sophistry/core/internal`.
 *
 * @example
 * ```ts
 * import { createScene, pointerDriver } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const stop = pointerDriver(scene)?.onWheel((event) => event.native.preventDefault());
 * ```
 *
 * @param scene - A scene made by `createScene`.
 * @returns Its {@link PointerDriver}, or null for a headless scene.
 * @category Interaction plumbing
 */
export function pointerDriver(scene: Scene): PointerDriver | null {
	return internals.get(scene)?.driver ?? null;
}

/**
 * A value that may be bound to a `Readable` and rebound later: a `Readable`
 * itself whose subscribers hear the bound source go stale and every rebind.
 */
interface Bindable<T> extends Readable<T> {
	/** Sets a plain value (unbinding) or binds to a `Readable`. */
	set(value: T | Readable<T>): void;
	/** Unbinds and drops every subscriber. */
	dispose(): void;
}

/** Makes a {@link Bindable} starting at `initial`. */
function bindable<T>(initial: T | Readable<T>): Bindable<T> {
	const subscribers = new Set<() => void>();
	let source: Readable<T> | null = null;
	let value = undefined as T;
	let unbind: (() => void) | null = null;
	const notify = () => {
		for (const onStale of [...subscribers]) onStale();
	};
	const assign = (next: T | Readable<T>) => {
		unbind?.();
		unbind = null;
		if (isReadable(next)) {
			source = next as Readable<T>;
			unbind = source.subscribe(notify);
		} else {
			source = null;
			value = next as T;
		}
	};
	assign(initial);
	return {
		peek: () => (source ? source.peek() : value),
		subscribe(onStale) {
			subscribers.add(onStale);
			return () => {
				subscribers.delete(onStale);
			};
		},
		set(next) {
			if (!source && !isReadable(next) && Object.is(value, next)) return;
			assign(next);
			notify();
		},
		dispose() {
			unbind?.();
			unbind = null;
			subscribers.clear();
		},
	};
}

/** A read-only view of a constant. */
function constant<T>(value: T): Readable<T> {
	return { peek: () => value, subscribe: () => () => {} };
}

/** The theme for `spec`: fixed when it names a theme or a mode, else following the page's mode. */
function themeSource(spec: ThemeSpec): Theme | Readable<Theme> {
	if (spec.theme || spec.mode) return resolveTheme(spec);
	const palette = spec.palette;
	return derive(colorModeReadable, (mode) => resolveTheme({ palette, mode }));
}

/**
 * The visible box in scene units. `units` fixes the width and the canvas
 * aspect decides the height; without a size, `aspect` does. `yUp` does not
 * enter into it: the box is symmetric about `center`, and flipping y only
 * changes which pixel row the top maps to.
 */
function frameBox(
	units: number,
	center: Point,
	size: SceneSize,
	aspect: number,
): Bounds {
	// `units` spans the canvas width, so a scene unit is `width / units`
	// pixels in both axes and the height in units follows the aspect ratio.
	const heightUnits =
		size.width > 0 && size.height > 0
			? (size.height * units) / size.width
			: units / aspect;
	return {
		minX: center.x - units / 2,
		minY: center.y - heightUnits / 2,
		maxX: center.x + units / 2,
		maxY: center.y + heightUnits / 2,
	};
}

const sameSize = (a: SceneSize, b: SceneSize) =>
	a.width === b.width && a.height === b.height;

/**
 * Creates a scene: a canvas (or none, headless) and the retained tree that
 * paints into it.
 *
 * The scene fills its host's width and takes its height from `aspect`.
 * Scene code works in scene units, never pixels: `units` span the full width
 * (defaults: 16 units at 16:9, so x in [-8, 8] and y in [-4.5, 4.5]), y up.
 * Add nodes to `scene.root` (or with `scene.add`); a write to a node marks
 * it, and the next frame commits and paints exactly what changed.
 *
 * @example
 * ```ts
 * import { circle, createScene, moveTo, trackPoint } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 8 });
 * const center = trackPoint(-2, 0);
 * scene.add(circle.create({ center, radius: 1.5 }));
 * await scene.play(moveTo(center, { x: 2, y: 0 }));
 * ```
 *
 * @param options - Where to paint (`host`, `canvas`, or neither for a
 * headless scene), framing (`units`, `center`, `yUp`, `aspect`), colours
 * (`theme`, `palette`, `mode`, `background`), time (`clock`,
 * `reducedMotion`, `reducedMotionTransition`) and `pauseWhenHidden`.
 * @returns The {@link Scene}.
 * @see {@link https://sophistry.dev/start/concepts/#the-stage}
 *
 * @category Stage & cameras
 */
export function createScene(options: SceneOptions = {}): Scene {
	const clock = options.clock ?? defaultClock;
	const aspect = options.aspect ?? 16 / 9;
	const transition = options.reducedMotionTransition ?? "fade";
	const pauseWhenHidden = options.pauseWhenHidden !== false;
	const headless =
		options.headless === true || (!options.canvas && !options.host);
	/** Cleanups run on dispose, in reverse order of registration. */
	const cleanups: (() => void)[] = [];
	/** The interaction layer's cleanups, run first on dispose. */
	const extensionCleanups: (() => void)[] = [];
	const lifetime = new AbortController();
	let disposed = false;

	/* ----------------------------------------------------------- inputs */

	const units = bindable<number>(options.units ?? 16);
	const center = bindable<Point>(options.center ?? { x: 0, y: 0 });
	const yUp = track(options.yUp !== false);
	const size = track<SceneSize>(
		headless && options.size
			? { width: options.size.width, height: options.size.height }
			: { width: 0, height: 0 },
		{ equals: sameSize },
	);
	const dpr = track(1);
	const theme = bindable<Theme>(
		themeSource({
			theme: options.theme,
			palette: options.palette,
			mode: options.mode,
		}),
	);
	const backgroundChoice = track<SceneBackground>(
		options.background ?? "theme",
	);
	cleanups.push(() => {
		units.dispose();
		center.dispose();
		theme.dispose();
	});

	/** The canvas fill as a CSS colour; `null` when the scene is transparent. */
	const background = derive(
		[theme, backgroundChoice],
		(current, choice): string | null => {
			if (choice === "theme") return current.palette.background;
			if (choice === "transparent") return null;
			return cssColor(choice);
		},
	);

	/** The scene's reduced-motion flag: its own option, else its clock's setting. */
	const reducedMotion: Readable<boolean> =
		options.reducedMotion === undefined
			? clock.reducedMotion
			: options.reducedMotion === "auto"
				? prefersReducedMotion
				: constant(options.reducedMotion === "reduce");

	const frame = derive(
		[units, center, size] as const,
		(widthUnits, middle, canvasSize) =>
			frameBox(widthUnits, middle, canvasSize, aspect),
	);

	const canonicalView = derive(
		[size, units, center, yUp] as const,
		(canvasSize, widthUnits, middle, up): Matrix =>
			viewMatrix(
				{ x: 0, y: 0, width: canvasSize.width, height: canvasSize.height },
				widthUnits,
				middle,
				up,
			),
	);

	/** What a camera that omits `units`, `center`, `yUp` or `background` falls back to. */
	const cameraDefaults = derive(
		[units, center, yUp, background] as const,
		(widthUnits, middle, up, fill): CameraDefaults => ({
			units: widthUnits,
			center: middle,
			yUp: up,
			background: fill,
		}),
	);
	// `graph` is declared below; the list subscribes lazily, once a camera
	// with an anchor arrives.
	const cameras = createCameraList(cameraDefaults, (listener) =>
		graph.onStructureChange(listener),
	);
	cleanups.push(() => cameras.dispose());

	/* ------------------------------------------------------------ graph */

	let renderer: Renderer | null = null;
	/** Every frame handed to the renderer: what picking and the mirror read. */
	const snapshot = track<readonly DrawSpec[]>([]);
	let withdrawCommit: (() => void) | null = null;
	const runCommit = () => {
		withdrawCommit = null;
		graph.commit();
	};
	const graph = new SceneGraph({
		yUp: yUp.peek(),
		// The default (the frame loop's commit phase), kept here so dispose can
		// withdraw a pending request.
		schedule: () => {
			withdrawCommit = requestFrame("commit", runCommit);
		},
		onFrame: (specs, frameOptions) => {
			renderer?.setFrame(specs, frameOptions);
			snapshot.set(specs);
		},
		// Glyphs painted in the fallback font change pixels no spec changed for.
		onFontLoad: () => renderer?.invalidate(),
	});
	const root = graph.root;
	root.provide(clockContext, clock);
	root.provide(reducedMotionContext, reducedMotion);
	root.provide(frameContext, frame);

	/* ------------------------------------------------------------- DOM */

	let canvas: HTMLCanvasElement | null = null;
	let element: HTMLElement | null = null;
	let created: HTMLElement | null = null;

	if (!headless) {
		if (options.canvas) {
			canvas = options.canvas;
			element = canvas.parentElement ?? canvas;
			// See the created canvas below for why the CSS size is pinned.
			if (!canvas.style.width) canvas.style.width = "100%";
			if (!canvas.style.height) canvas.style.height = "100%";
		} else {
			const host = options.host as HTMLElement;
			const document = host.ownerDocument;
			const box = document.createElement("div");
			box.className = options.class ?? DEFAULT_CLASS;
			// Inline rather than utility classes: the canvas-sizing feedback loop
			// below must hold even in a page whose utility pipeline never scans
			// this package, so the critical sizing cannot depend on generated CSS.
			// `relative` so the accessibility mirror's absolutely positioned
			// elements are placed against the canvas.
			box.style.aspectRatio = String(aspect);
			box.style.position = "relative";
			box.style.width = "100%";
			box.style.overflow = "hidden";
			const surface = document.createElement("canvas");
			surface.className = "block h-full w-full";
			// The backing store is `box rect × dpr` device pixels; without a CSS
			// size pinning the canvas to the box, it would lay out at its
			// intrinsic (backing-store) size, grow the box, and the resize
			// observer would multiply by dpr again: an exponential loop that ends
			// at the browser's maximum-canvas-area error.
			surface.style.display = "block";
			surface.style.width = "100%";
			surface.style.height = "100%";
			// A picture with no text and no structure; the accessibility mirror is
			// what assistive technology reads instead.
			surface.setAttribute("aria-hidden", "true");
			box.append(surface);
			host.append(box);
			canvas = surface;
			element = box;
			created = box;
		}
	}

	/* ------------------------------------------------------------- sync */

	/**
	 * Pushes the framing, theme, background, size and cameras into the graph
	 * and the renderer. Runs in the commit phase after any of them went stale
	 * (before or beside the graph's own commit: a theme change marks nodes,
	 * which then commit in the same phase), and at creation.
	 */
	let withdrawSync: (() => void) | null = null;
	const sync = () => {
		withdrawSync = null;
		if (disposed) return;
		graph.setYUp(yUp.peek());
		const currentTheme = theme.peek();
		root.provide(themeContext, currentTheme);
		if (!renderer || !canvas) return;
		const currentSize = size.peek();
		// Resizing the backing store clears it; the renderer repaints because
		// its size changed too, later in this same frame.
		if (canvas.width !== currentSize.width) canvas.width = currentSize.width;
		if (canvas.height !== currentSize.height)
			canvas.height = currentSize.height;
		renderer.setSize(currentSize);
		renderer.setDpr(dpr.peek());
		renderer.setTheme(currentTheme);
		renderer.setBackground(background.peek());
		renderer.setCanonicalView(canonicalView.peek());
		renderer.setCameras(cameras.views.peek());
	};
	const requestSync = () => {
		if (disposed || withdrawSync) return;
		withdrawSync = requestFrame("commit", sync);
	};
	for (const source of [
		yUp,
		theme,
		background,
		size,
		dpr,
		canonicalView,
		cameras.views,
	] as Readable<unknown>[]) {
		cleanups.push(source.subscribe(requestSync));
	}

	/**
	 * Asks for a frame for the renderer's paint. A request made in the tick or
	 * commit phase (a new frame from the graph, a resize) is already answered
	 * by this frame's paint phase, so it wakes nothing: a bare wake there would
	 * outlive the frame and cost an empty one after it. From inside `paint()`
	 * (a running dissolve, the layer cache) it wakes the next frame.
	 */
	const requestPaint = () => {
		const phase = currentFramePhase();
		if (phase === "tick" || phase === "commit") return;
		requestFrame();
	};

	if (canvas && element) {
		const observed = element;
		const target = canvas;
		const view = observed.ownerDocument.defaultView;

		const measure = () => {
			const rect = observed.getBoundingClientRect();
			const ratio = view?.devicePixelRatio || 1;
			dpr.set(ratio);
			// A box not laid out yet (a host the bindings attach after creating
			// the scene, a `display: none` ancestor) measures 0×0. Keep the
			// unknown size, so the frame takes its height from `aspect` rather
			// than from a 1×1 square, until the observer sees the real box.
			if (rect.width === 0 || rect.height === 0) return;
			// Clamped to the browser's canvas limit so a layout that feeds the
			// backing store back into the box cannot escalate without bound.
			size.set({
				width: clampSide(rect.width * ratio),
				height: clampSide(rect.height * ratio),
			});
		};
		measure();

		const paintRenderer = createCanvasRenderer({
			canvas: target,
			theme: theme.peek(),
			size: size.peek(),
			onPaintRequest: requestPaint,
		});
		renderer = paintRenderer;
		cleanups.push(() => paintRenderer.dispose());
		// Passive: it paints in frames something else caused (a commit, a clock,
		// the renderer's own request), and costs a boolean check otherwise.
		cleanups.push(
			onFrame(
				"paint",
				() => {
					if (paintRenderer.needsPaint()) paintRenderer.paint();
				},
				{ awake: false },
			),
		);

		if (typeof ResizeObserver === "function") {
			const observer = new ResizeObserver(measure);
			observer.observe(observed);
			cleanups.push(() => observer.disconnect());
		}

		// A change of devicePixelRatio (dragging to another monitor, browser
		// zoom) does not resize the box, so the observer alone would miss it. A
		// `resolution` query matches one ratio only, so it is re-armed for the
		// new ratio each time it fires.
		let unwatchDpr: (() => void) | null = null;
		const watchDpr = () => {
			unwatchDpr?.();
			unwatchDpr = null;
			if (!view || typeof view.matchMedia !== "function") return;
			const query = view.matchMedia(
				`(resolution: ${view.devicePixelRatio || 1}dppx)`,
			);
			const onChange = () => {
				measure();
				watchDpr();
			};
			query.addEventListener?.("change", onChange);
			unwatchDpr = () => query.removeEventListener?.("change", onChange);
		};
		watchDpr();
		cleanups.push(() => unwatchDpr?.());

		// Off-screen scenes neither paint nor tick their own clock.
		if (typeof IntersectionObserver === "function") {
			const gate: VisibilityHandle | null =
				options.clock && pauseWhenHidden
					? watchClockVisibility(options.clock)
					: null;
			const watcher = new IntersectionObserver(
				(entries) => {
					const entry = entries[entries.length - 1];
					if (!entry || disposed) return;
					const visible = entry.isIntersecting || !pauseWhenHidden;
					paintRenderer.setVisible(visible);
					gate?.setVisible(visible);
				},
				{ rootMargin: "100px" },
			);
			watcher.observe(observed);
			cleanups.push(() => {
				watcher.disconnect();
				gate?.dispose();
			});
		}
	}

	// The initial state lands at once, so the first commit sees the theme and
	// the renderer its size; then the first frame: the graph's first commit
	// (an empty scene still publishes its empty frame) and, since the renderer
	// starts dirty, the first paint.
	sync();
	withdrawCommit = requestFrame("commit", runCommit);

	/* ------------------------------------------------------------- runs */

	/** Shows a reduced-motion run's jump: a short dissolve unless the scene asks for a cut. */
	const onReducedJump = () => {
		if (transition === "cut") return;
		renderer?.dissolve(REDUCED_MOTION_FADE);
	};

	/** The scene's clock, reduced motion and lifetime, under a run's own overrides. */
	const runContext = (override: PlayContext = {}): PlayContext => ({
		clock: override.clock ?? clock,
		signal: anySignal(lifetime.signal, override.signal),
		reducedMotion: override.reducedMotion ?? reducedMotion,
		motion: override.motion,
		onReducedJump: override.onReducedJump ?? onReducedJump,
	});

	/* ------------------------------------------------------ interaction */

	const registry = createInteractionRegistry(graph);
	const focus = createFocusChannel();
	const pointer = createPointerChannel();
	root.provide(pointerContext, pointer.state);
	cleanups.push(() => registry.dispose());

	/* ------------------------------------------------------------ scene */

	const scene: Scene = {
		root,
		clock,
		canvas,
		element,
		headless,
		frame,
		size: { peek: size.peek, subscribe: size.subscribe },
		dpr: { peek: dpr.peek, subscribe: dpr.subscribe },
		theme: { peek: theme.peek, subscribe: theme.subscribe },
		background,
		reducedMotion,
		canonicalView,
		cameraViews: cameras.views,
		pointer: pointer.state,
		focus,
		add: (node) => root.add(node),
		setView(view) {
			if (disposed) return;
			if (view.units !== undefined) units.set(view.units);
			if (view.center !== undefined) center.set(view.center);
			if (view.yUp !== undefined) yUp.set(view.yUp);
		},
		setTheme(spec) {
			if (disposed) return;
			theme.set(themeSource(spec));
		},
		setBackground(choice) {
			if (disposed) return;
			backgroundChoice.set(choice);
		},
		addCamera: (cameraOptions) => cameras.add(cameraOptions),
		play(...args) {
			const { animations, context } = splitPlayArguments(args);
			return playAnimations(...animations, runContext(context));
		},
		timeline: (animation, context) =>
			createTimeline(animation, runContext(context)),
		commit() {
			if (disposed) return false;
			if (withdrawSync) {
				withdrawSync();
				sync();
			}
			return graph.commit();
		},
		snapshot: () => (renderer ? renderer.snapshot() : graph.frame),
		dispose() {
			if (disposed) return;
			disposed = true;
			lifetime.abort();
			for (const cleanup of extensionCleanups.splice(0).reverse()) cleanup();
			withdrawSync?.();
			withdrawSync = null;
			withdrawCommit?.();
			withdrawCommit = null;
			for (const cleanup of cleanups.splice(0).reverse()) cleanup();
			graph.dispose();
			created?.remove();
			renderer = null;
		},
	};

	/* ---------------------------------------- pointer and accessibility */

	// Beside the renderer, not inside it: picking reads the snapshot the
	// renderer is handed and nothing else, so it stays off the paint path. The
	// driver gets the same views and the same canonical matrix the renderer
	// paints through, so `pickCamera` resolves overlap the way the painting
	// does and a gesture cannot land in a pane it isn't over.
	let driver: PointerDriver | null = null;
	if (canvas && element) {
		const activeDriver = createPointerDriver({
			canvas,
			host: element,
			registry,
			snapshot,
			size,
			canonicalView,
			cameraViews: cameras.views,
			dpr,
			pointer: (value) => pointer.set(value),
			focus: (id) => focus.set(id, "pointer"),
		});
		driver = activeDriver;
		extensionCleanups.push(() => activeDriver.destroy());

		const mirror = createAccessibilityMirror({
			host: element,
			registry,
			focus,
			snapshot,
			size,
			canonicalView,
			cameraViews: cameras.views,
			dpr,
			driver: () => driver,
			onItem: (item) => renderer?.setFocusItem(item),
		});
		extensionCleanups.push(() => mirror.dispose());

		/**
		 * The focus ring: the focused node and the rest of its group, only while
		 * focus is visible (moved by a key). Re-read in the commit phase after
		 * the focus or the registry went stale.
		 */
		let ringed: readonly number[] | null = null;
		let withdrawRing: (() => void) | null = null;
		const syncRing = () => {
			withdrawRing = null;
			if (disposed) return;
			const ids = focusIds(registry, focus);
			const same =
				ids === ringed ||
				(ids !== null &&
					ringed !== null &&
					ids.length === ringed.length &&
					ids.every((id, i) => id === ringed?.[i]));
			if (same) return;
			ringed = ids;
			renderer?.setFocus(ids);
		};
		const requestRing = () => {
			if (disposed || withdrawRing) return;
			withdrawRing = requestFrame("commit", syncRing);
		};
		const stopRing = [
			focus.state.subscribe(requestRing),
			registry.version.subscribe(requestRing),
		];
		extensionCleanups.push(() => {
			withdrawRing?.();
			for (const stop of stopRing) stop();
		});
	}

	internals.set(scene, {
		graph,
		get renderer() {
			return renderer;
		},
		onDispose(cleanup) {
			if (disposed) cleanup();
			else extensionCleanups.push(cleanup);
		},
		registry,
		focus,
		driver,
		snapshot: { peek: snapshot.peek, subscribe: snapshot.subscribe },
		setFocusItem: (item) => renderer?.setFocusItem(item),
	});

	return scene;
}
