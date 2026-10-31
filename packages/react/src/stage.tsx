/**
 * `<Stage>`: a scene in a React tree. It renders a `<div>`, creates a scene in
 * it (`createScene`) and renders its children into the scene through the
 * Sophistry reconciler.
 */

import type {
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
import { createScene } from "@sophistry/core";
import { DEFAULT_BOX_CLASS } from "@sophistry/core/internal";
import { FiberProvider, useContextBridge } from "its-fine";
import {
	Component,
	type CSSProperties,
	type ReactNode,
	type Ref,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { ConcurrentRoot } from "react-reconciler/constants";
import { bridge, ClockContext } from "./context";
import { reconciler } from "./reconciler";

/**
 * Props for {@link Stage} (and {@link MultiStage}).
 *
 * Reactive: `units`, `center`, `yUp` (`scene.setView`), `theme`, `palette`,
 * `mode` (`scene.setTheme`), `background` (`scene.setBackground`),
 * `aspect` (the box's CSS `aspect-ratio`), `boxClass`, `className` and
 * `style`. Read once, when the scene is
 * created: `clock`, `reducedMotion`, `reducedMotionTransition`,
 * `pauseWhenHidden` (changing them later warns and has no effect; remount the
 * stage with a `key` to apply them).
 *
 * @category Stage & cameras
 */
export interface StageProps {
	/**
	 * Scene units spanning the canvas width. Larger values zoom out. A
	 * `Readable` (a `Track`) binds, so animating it zooms without re-rendering.
	 *
	 * @default 16
	 */
	units?: number | Readable<number>;
	/**
	 * The scene point at the middle of the canvas. A `Readable` binds, so a
	 * moving point pans the view.
	 *
	 * @default { x: 0, y: 0 }
	 */
	center?: Point | Readable<Point>;
	/**
	 * Maths convention: `y` increases upward. `false` for the canvas
	 * convention.
	 *
	 * @default true
	 */
	yUp?: boolean;
	/**
	 * Width divided by height of the box the canvas sits in.
	 *
	 * @default 16 / 9
	 */
	aspect?: number;
	/** A fully-built theme, used as-is; wins over `palette` and `mode`. */
	theme?: Theme;
	/** A built-in palette name or a palette object; defaults to Catppuccin. */
	palette?: ThemeSpec["palette"];
	/** Light or dark; defaults to the page's mode, followed live. */
	mode?: ThemeSpec["mode"];
	/**
	 * What the canvas is filled with before the scene paints.
	 *
	 * @default "theme"
	 */
	background?: SceneBackground;
	/**
	 * The clock scene scripts run on (`usePlayer`, `useClock`). Defaults to
	 * the nearest `<ClockProvider>`'s, else the shared `defaultClock`. Read once, at creation.
	 */
	clock?: Clock;
	/** Reduced-motion mode for runs on this scene. Read once, at creation. */
	reducedMotion?: ReducedMotion;
	/**
	 * How a reduced-motion jump looks (`"fade"` or `"cut"`). Read once, at
	 * creation.
	 *
	 * @default "fade"
	 */
	reducedMotionTransition?: ReducedMotionTransition;
	/**
	 * Skip painting, and suspend the scene's own `clock`, while scrolled out
	 * of view. Read once, at creation.
	 *
	 * @default true
	 */
	pauseWhenHidden?: boolean;
	/** Classes of the `<div>` the stage renders (the scene's box sits inside it). */
	className?: string;
	/**
	 * Classes of the scene's box inside that `<div>`, replacing core's
	 * default `"w-full overflow-hidden rounded-xl"` (width, aspect ratio,
	 * position and overflow are inline either way).
	 */
	boxClass?: string;
	/** Inline style of the `<div>` the stage renders. */
	style?: CSSProperties;
	/** Scene content: Sophistry elements and components rendering them. */
	children?: ReactNode;
	/**
	 * Receives the {@link Scene} once it exists (in a layout effect, after
	 * the children's first render), and null when the stage unmounts.
	 */
	ref?: Ref<Scene>;
}

/** Props read once, at creation. */
const CREATION_ONLY = [
	"clock",
	"reducedMotion",
	"reducedMotionTransition",
	"pauseWhenHidden",
] as const;

type Options = Omit<StageProps, "className" | "style" | "children" | "ref">;

/** A live stage: its scene, its reconciler root and the options last applied. */
interface Mounted {
	scene: Scene;
	root: ReturnType<typeof reconciler.createContainer>;
	applied: Options;
	/** Rethrows an error from inside the root in the outer tree. */
	onError: (error: unknown) => void;
}

/** Sets a ref (object or callback) and returns how to clear it. */
function assignRef<T>(ref: Ref<T> | undefined, value: T): () => void {
	if (!ref) return () => {};
	if (typeof ref === "function") {
		const cleanup = ref(value);
		return typeof cleanup === "function" ? cleanup : () => ref(null);
	}
	ref.current = value;
	return () => {
		ref.current = null;
	};
}

const isPlainPoint = (value: unknown): value is Point =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as Point).x === "number" &&
	typeof (value as Point).y === "number" &&
	typeof (value as { peek?: unknown }).peek !== "function";

/** Same view value: identical, or two plain points with the same coordinates. */
function sameViewValue(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	return isPlainPoint(a) && isPlainPoint(b) && a.x === b.x && a.y === b.y;
}

/** Pushes the reactive options that changed since `mounted.applied` into the scene. */
function applyOptions(mounted: Mounted, options: Options): void {
	const { scene, applied } = mounted;
	if (
		!sameViewValue(applied.units, options.units) ||
		!sameViewValue(applied.center, options.center) ||
		applied.yUp !== options.yUp
	) {
		scene.setView({
			units: options.units ?? 16,
			center: options.center ?? { x: 0, y: 0 },
			yUp: options.yUp !== false,
		});
	}
	if (
		applied.theme !== options.theme ||
		applied.palette !== options.palette ||
		applied.mode !== options.mode
	) {
		scene.setTheme({
			theme: options.theme,
			palette: options.palette,
			mode: options.mode,
		});
	}
	if (applied.background !== options.background) {
		scene.setBackground(options.background ?? "theme");
	}
	if (applied.aspect !== options.aspect && scene.element) {
		// The scene sizes its box from `aspect` once; the canvas is measured
		// from the box, so a new CSS ratio is all it takes.
		scene.element.style.aspectRatio = String(options.aspect ?? 16 / 9);
	}
	if (applied.boxClass !== options.boxClass && scene.element) {
		scene.element.className = options.boxClass ?? DEFAULT_BOX_CLASS;
	}
	for (const key of CREATION_ONLY) {
		if (applied[key] !== options[key]) {
			console.warn(
				`Sophistry: <Stage ${key}> is read once, when the scene is created; the change is ignored. Give the <Stage> a new key to recreate it.`,
			);
		}
	}
	mounted.applied = { ...options };
}

/**
 * The outermost component inside a stage's root: catches what its children
 * throw and hands it to the stage, which rethrows it in the outer tree.
 */
class ErrorForwarder extends Component<
	{ onError: (error: unknown) => void; children: ReactNode },
	{ failed: boolean }
> {
	override state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	override componentDidCatch(error: unknown) {
		this.props.onError(error);
	}
	override render(): ReactNode {
		return this.state.failed ? null : this.props.children;
	}
}

/**
 * A canvas and the scene that paints into it: the root of every Sophistry
 * figure in React.
 *
 * Renders a `<div>` (`className`, `style`) holding the scene's box (as wide
 * as the div, its height from `aspect`) with the canvas and the
 * accessibility mirror. The children render into the scene through the
 * Sophistry reconciler: use Sophistry elements (`<Circle>`, `<Group>`, ...)
 * and components that render them; DOM elements and text are errors inside
 * (put them beside the stage). React contexts from above the stage are
 * available inside it, and `useScene()`/`useClock()`/`usePlayer()` find this
 * scene.
 *
 * The children render synchronously in the stage's layout effect, so the
 * scene is complete (and node refs set) by the time a parent's layout
 * effects run. An error thrown inside is rethrown from the stage, to the
 * nearest error boundary above it. Unmounting unmounts the children
 * (disposing their nodes) and disposes the scene.
 *
 * @example
 * ```tsx
 * import { Circle, Label, Stage } from "@sophistry/react";
 *
 * export function Hello() {
 * 	return (
 * 		<Stage units={8}>
 * 			<Circle center={{ x: 0, y: 0 }} radius={1.5} />
 * 			<Label text="radius 1.5" y={-2.5} />
 * 		</Stage>
 * 	);
 * }
 * ```
 *
 * @param props - Framing, colours, time options and children; see
 * {@link StageProps}.
 * @returns A `<div>` containing the scene.
 * @category Stage & cameras
 */
export function Stage(props: StageProps): ReactNode {
	// Its own `FiberProvider`, so the context bridge works without the app
	// wrapping its tree in one.
	return (
		<FiberProvider>
			<StageRoot {...props} />
		</FiberProvider>
	);
}

/**
 * A {@link Stage} viewed through one camera per `<Camera>` inside it. The
 * same component as `Stage` (a stage with no `<Camera>` paints its own
 * single view); the name says what the figure is.
 *
 * @example
 * ```tsx
 * import { Camera, Circle, MultiStage } from "@sophistry/react";
 *
 * <MultiStage units={8}>
 * 	<Circle radius={1} />
 * 	<Camera viewport={{ x: 0, y: 0, width: 0.5, height: 1 }} />
 * 	<Camera viewport={{ x: 0.5, y: 0, width: 0.5, height: 1 }} units={2} />
 * </MultiStage>;
 * ```
 *
 * @category Stage & cameras
 */
export const MultiStage: (props: MultiStageProps) => ReactNode = Stage;

/**
 * Props for {@link MultiStage}: the same as {@link StageProps}.
 *
 * @category Stage & cameras
 */
export type MultiStageProps = StageProps;

function StageRoot(props: StageProps) {
	const { className, style, children, ref, ...options } = props;
	const host = useRef<HTMLDivElement>(null);
	const mounted = useRef<Mounted | null>(null);
	const Bridge = useContextBridge();
	const providedClock = useContext(ClockContext);
	// An error inside the stage's root, rethrown here so the nearest error
	// boundary above the stage sees it.
	const [failure, setFailure] = useState<{ error: unknown } | null>(null);
	if (failure) throw failure.error;

	// Created once per mount (twice under StrictMode, which disposes the first).
	// biome-ignore lint/correctness/useExhaustiveDependencies: created once; later changes go through the effect below
	useLayoutEffect(() => {
		const element = host.current as HTMLDivElement;
		const { boxClass, ...sceneOptions } = options;
		const scene = createScene({
			...sceneOptions,
			clock: sceneOptions.clock ?? providedClock ?? undefined,
			class: boxClass,
			host: element,
		});
		const onError = (error: unknown) => setFailure({ error });
		const root = reconciler.createContainer(
			scene.root,
			ConcurrentRoot,
			null,
			false,
			null,
			"",
			onError,
			reconciler.defaultOnCaughtError,
			reconciler.defaultOnRecoverableError,
			() => {},
			null,
		);
		mounted.current = { scene, root, applied: { ...options }, onError };
		return () => {
			mounted.current = null;
			reconciler.updateContainerSync(null, root, null, null);
			reconciler.flushSyncWork();
			scene.dispose();
		};
	}, []);

	// Every render: push changed options, then render the children.
	useLayoutEffect(() => {
		const state = mounted.current;
		if (!state) return;
		applyOptions(state, options);
		reconciler.updateContainerSync(
			<ErrorForwarder onError={state.onError}>
				{bridge(Bridge, state.scene, children)}
			</ErrorForwarder>,
			state.root,
			null,
			null,
		);
		reconciler.flushSyncWork();
	});

	// After the children, so a ref sees a populated scene.
	useLayoutEffect(() => {
		const state = mounted.current;
		return state ? assignRef(ref, state.scene) : undefined;
	}, [ref]);

	return <div ref={host} className={className} style={style} />;
}
