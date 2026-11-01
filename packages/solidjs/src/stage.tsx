/**
 * `<Stage>`, `<MultiStage>` and `<Camera>`: a scene made with core's
 * `createScene`, mounted in a `<div>`, with its children as scene nodes.
 *
 * The stage provides its `Scene` through a Solid context (`useScene`), so
 * wrapped components below see it at creation, and resolves its children
 * with the same `children()` pattern as `wrap`, handing the nodes to
 * `scene.root.setChildren`. Contexts the page provides above the stage flow
 * through to the components inside it untouched.
 */

import type { JSX } from "@solidjs/web";
import { isServer } from "@solidjs/web";
import type {
	CameraOptions,
	Clock,
	Point,
	Readable,
	ReducedMotion,
	ReducedMotionTransition,
	Scene,
	SceneBackground,
	Theme,
	ThemeSpec,
} from "@sophistry/core";
import { createScene, group } from "@sophistry/core";
import { DEFAULT_BOX_CLASS } from "@sophistry/core/internal";
import { children, createRenderEffect, onCleanup, untrack } from "solid-js";
import { currentClock, SceneContext, useScene } from "./context.js";
import { childNodes } from "./nodes.js";

/**
 * Props for {@link Stage} (and {@link MultiStage}).
 *
 * Reactive: `units`, `center`, `yUp` (through `scene.setView`), `theme`,
 * `palette`, `mode` (through `scene.setTheme`), `background`
 * (`scene.setBackground`), `class`, `boxClass` and `style`. A `Readable` for `units` or
 * `center` binds in core, so a `track()` zooms or pans with no Solid work per
 * frame. Read once, at creation: `aspect`, `clock`, `reducedMotion`,
 * `reducedMotionTransition`, `pauseWhenHidden`.
 *
 * @category Stage & cameras
 */
export interface StageProps {
	/**
	 * How many scene units span the stage's full width. Larger values zoom
	 * out. The visible height follows from `aspect` (9 at the defaults). A
	 * `Readable` binds, so a `track()` zooms.
	 *
	 * @default 16
	 */
	units?: number | Readable<number>;
	/**
	 * The scene point shown at the middle of the stage, in scene units. A
	 * `Readable` binds, so a moving point pans the view.
	 *
	 * @default { x: 0, y: 0 }
	 */
	center?: Point | Readable<Point>;
	/**
	 * Maths convention: `y` increases upward on screen. Pass `false` for the
	 * canvas convention.
	 *
	 * @default true
	 */
	yUp?: boolean;
	/**
	 * Width divided by height of the stage's box (the CSS `aspect-ratio`).
	 * Read once.
	 *
	 * @default 16 / 9
	 */
	aspect?: number;
	/** A fully-built theme, used as-is; wins over `palette` and `mode`. */
	theme?: Theme;
	/** A built-in palette name or a palette object; defaults to Catppuccin. */
	palette?: ThemeSpec["palette"];
	/**
	 * Which variant of the palette to paint. Defaults to the page's current
	 * mode, followed live.
	 */
	mode?: ThemeSpec["mode"];
	/**
	 * What the canvas is filled with before the scene paints: `"theme"`,
	 * `"transparent"`, or any colour. Cameras inherit it.
	 *
	 * @default "theme"
	 */
	background?: SceneBackground;
	/**
	 * The clock the scene's scripts run on (`usePlayer`, `useClock`). Defaults
	 * to the nearest `<ClockProvider>`'s, else the shared `defaultClock`; give each stage its own `createClock()`
	 * when several need independent pause and speed. Read once.
	 */
	clock?: Clock;
	/**
	 * Reduced-motion mode for runs started through the scene (`usePlayer`):
	 * `"auto"`, `"reduce"` or `"no-preference"`; omitted defers to the clock.
	 * Read once.
	 */
	reducedMotion?: ReducedMotion;
	/**
	 * How a reduced-motion jump looks: `"fade"` or `"cut"`. Read once.
	 *
	 * @default "fade"
	 */
	reducedMotionTransition?: ReducedMotionTransition;
	/**
	 * Skip painting, and suspend the stage's own `clock`, while scrolled out
	 * of view. Read once.
	 *
	 * @default true
	 */
	pauseWhenHidden?: boolean;
	/** CSS classes of the outer `<div>` the stage renders (the scene's box sits inside it). */
	class?: string;
	/**
	 * CSS classes of the scene's box inside the outer `<div>`, replacing
	 * core's default `"w-full overflow-hidden rounded-xl"` (width, aspect
	 * ratio, position and overflow are inline either way).
	 */
	boxClass?: string;
	/** Inline style of the outer `<div>` the stage renders. */
	style?: JSX.CSSProperties | string;
	/** Called once with the scene, after the children are in it. */
	ref?: (scene: Scene) => void;
	/** Scene components (`<Circle>`, `<Group>`, ...) and `<Camera>`s. */
	children?: JSX.Element;
}

/**
 * A canvas and the scene that paints into it: the root of every scene.
 *
 * The stage fills its container's width and takes its height from `aspect`.
 * Scene code works in scene units, never pixels: `units` span the full width
 * (16 units at 16:9 by default, so x in [-8, 8] and y in [-4.5, 4.5]), y up.
 * Interactive nodes get pointer input and a keyboard-accessible DOM mirror.
 * Disposing the stage disposes the scene and every node in it. Under server
 * rendering it renders the empty box only: the scene is built in the browser.
 *
 * @param props - See {@link StageProps}.
 * @returns A `<div>` holding the scene's box (canvas and accessibility layer).
 *
 * @example
 * ```tsx
 * import { Circle, Label, Stage } from "@sophistry/solidjs";
 *
 * export function Hello() {
 * 	return (
 * 		<Stage units={8}>
 * 			<Circle radius={1.5} />
 * 			<Label text="radius 1.5" y={-2.5} />
 * 		</Stage>
 * 	);
 * }
 * ```
 *
 * @see {@link MultiStage}
 * @category Stage & cameras
 */
export function Stage(props: StageProps): JSX.Element {
	const host = (
		<div class={props.class} style={props.style} />
	) as HTMLDivElement;
	// Server rendering: a scene needs a canvas and a layout, so the server
	// sends the empty box and the browser builds the scene when it renders.
	if (isServer) return host;
	const scene = untrack(() =>
		createScene({
			host,
			units: props.units,
			center: props.center,
			yUp: props.yUp,
			aspect: props.aspect,
			theme: props.theme,
			palette: props.palette,
			mode: props.mode,
			background: props.background,
			clock: props.clock ?? currentClock() ?? undefined,
			reducedMotion: props.reducedMotion,
			reducedMotionTransition: props.reducedMotionTransition,
			pauseWhenHidden: props.pauseWhenHidden,
			class: props.boxClass,
		}),
	);
	onCleanup(() => scene.dispose());

	// The framing, one key at a time; the first run is what was created.
	followFirstSkipped(
		() => props.units,
		(units) => scene.setView({ units: units ?? 16 }),
	);
	followFirstSkipped(
		() => props.center,
		(center) => scene.setView({ center: center ?? { x: 0, y: 0 } }),
	);
	followFirstSkipped(
		() => props.yUp,
		(yUp) => scene.setView({ yUp: yUp !== false }),
	);
	followFirstSkipped(
		() => ({ theme: props.theme, palette: props.palette, mode: props.mode }),
		(spec) => scene.setTheme(spec),
		(a, b) =>
			a.theme === b.theme && a.palette === b.palette && a.mode === b.mode,
	);
	followFirstSkipped(
		() => props.background,
		(background) => scene.setBackground(background ?? "theme"),
	);
	followFirstSkipped(
		() => props.boxClass,
		(className) => {
			if (scene.element)
				scene.element.className = className ?? DEFAULT_BOX_CLASS;
		},
	);

	// The provider's children resolve under it, so every descendant sees the
	// scene; the stage only keeps their scene nodes.
	const provided = <SceneContext value={scene}>{props.children}</SceneContext>;
	const resolved = children(() => provided);
	createRenderEffect(
		() => childNodes(resolved.toArray(), "Stage"),
		(nodes) => scene.root.setChildren(nodes),
	);

	untrack(() => props.ref)?.(scene);
	return host;
}

/**
 * Props for {@link MultiStage}: the same as {@link StageProps}. `units`,
 * `center` and `yUp` are the framing each `<Camera>` falls back to.
 *
 * @category Stage & cameras
 */
export type MultiStageProps = StageProps;

/**
 * A stage viewed through one camera per `<Camera>` child. The scene is
 * described once, in scene units, and each camera paints that snapshot under
 * its own view, so panning or zooming a camera rebuilds nothing. With no
 * `<Camera>` children it is a plain {@link Stage} (it is the same component;
 * the name says what the scene is for).
 *
 * @example
 * ```tsx
 * import { Camera, Circle, MultiStage } from "@sophistry/solidjs";
 *
 * export const TwoViews = () => (
 * 	<MultiStage units={10}>
 * 		<Circle radius={2} />
 * 		<Camera viewport={{ x: 0, y: 0, width: 0.5, height: 1 }} />
 * 		<Camera viewport={{ x: 0.5, y: 0, width: 0.5, height: 1 }} units={4} />
 * 	</MultiStage>
 * );
 * ```
 *
 * @category Stage & cameras
 */
export const MultiStage: (props: MultiStageProps) => JSX.Element = Stage;

/**
 * Props for {@link Camera}: core's `CameraOptions` minus `anchor` (the
 * component is its own anchor). Every prop is reactive; `units`, `center`,
 * `border` and `background` may be `Readable`s, which bind (a camera
 * following a moving point, or a border following the theme, costs no Solid
 * work).
 *
 * @category Stage & cameras
 */
export type CameraProps = Omit<CameraOptions, "anchor">;

/** Every camera option, each followed by one render effect. */
const CAMERA_KEYS = [
	"units",
	"center",
	"yUp",
	"viewport",
	"border",
	"borderWidth",
	"background",
] as const satisfies readonly (keyof CameraOptions)[];

/**
 * One view of the enclosing stage's scene: a rectangle of the canvas plus
 * what it looks at (`scene.addCamera`). Draws nothing; a camera that omits
 * `units`, `center` or `yUp` inherits the stage's. Disposed with its owner.
 *
 * Cameras paint in JSX order, later over earlier,: the
 * component returns an empty node, the camera's `anchor`, which sits in the
 * scene tree where the `<Camera>` is, so a camera shown later by a `<Show>`
 * still paints in its place. (Put cameras directly in the stage or a plain
 * `<Group>`; a layout composite would count the anchor as a child.)
 *
 * @param props - See {@link CameraProps}.
 * @returns The camera's anchor: an empty node, no DOM.
 * @throws When rendered outside a `<Stage>` or `<MultiStage>`.
 *
 * @category Stage & cameras
 */
export function Camera(props: CameraProps): JSX.Element {
	const scene = useScene();
	const anchor = group.create({});
	const options: CameraOptions = { anchor };
	untrack(() => {
		for (const key of CAMERA_KEYS) {
			if (props[key] !== undefined)
				(options as Record<string, unknown>)[key] = props[key];
		}
	});
	const camera = scene.addCamera(options);
	onCleanup(() => {
		camera.dispose();
		anchor.dispose();
	});
	for (const key of CAMERA_KEYS) {
		followFirstSkipped(
			() => props[key],
			(value) => camera.update({ [key]: value }),
		);
	}
	return anchor as unknown as JSX.Element;
}

/**
 * A render effect that calls `apply` when `read()` changes, skipping the
 * first run (the value the scene or camera was created with).
 */
function followFirstSkipped<T>(
	read: () => T,
	apply: (value: T) => void,
	equals: (a: T, b: T) => boolean = Object.is,
): void {
	let first = true;
	let last: T;
	createRenderEffect(read, (value) => {
		if (first) {
			first = false;
			last = value;
			return;
		}
		if (equals(value, last)) return;
		last = value;
		apply(value);
	});
}
