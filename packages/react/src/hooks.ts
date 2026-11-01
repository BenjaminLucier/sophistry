/**
 * Hooks: the enclosing scene and clock, tracks owned by a component, a
 * track's value as React state, a player bound to the scene, and a movable
 * point.
 */

import type {
	Animation,
	Clock,
	DraggableProps,
	DragOptions,
	PlayContext,
	PlayResult,
	Point,
	Readable,
	Scene,
	Theme,
	Timeline,
	Track,
} from "@sophistry/core";
import {
	anySignal,
	colorModeReadable,
	defaultClock,
	derive,
	draggable,
	play,
	resolveTheme,
	splitPlayArguments,
	timeline,
	track,
	trackPoint,
} from "@sophistry/core";
import {
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { ClockContext, SceneContext } from "./context.js";

/**
 * The scene of the enclosing `<Stage>`. Call it in a component rendered
 * inside the stage.
 *
 * @returns The {@link Scene}.
 * @throws Outside a `<Stage>` (a component beside the stage can take the
 * scene from the stage's `ref` instead).
 * @category Stage & cameras
 */
export function useScene(): Scene {
	const scene = useContext(SceneContext);
	if (!scene) {
		throw new Error(
			"Sophistry: useScene() must be called inside a <Stage>. Beside the stage, read the scene from <Stage ref>.",
		);
	}
	return scene;
}

/**
 * The clock of the enclosing `<Stage>` (its `clock` prop, else the nearest
 * `<ClockProvider>`'s, else `defaultClock`); outside a stage, the provider's
 * or `defaultClock`.
 *
 * Read `clock.time`/`clock.paused` with {@link useTrackValue} for a playback
 * UI, or pass `{ clock }` to `play()`/`tween()`.
 *
 * @returns The {@link Clock}.
 * @category Tracks & clocks
 */
export function useClock(): Clock {
	const provided = useContext(ClockContext);
	return useContext(SceneContext)?.clock ?? provided ?? defaultClock;
}

/**
 * A `Track` owned by the component: made once, on the first render, and the
 * same object on every later render (`initial` and `options` are read once).
 *
 * Pass the track itself as a prop (`<Circle radius={radius} />`): the node
 * binds to it, so animating it repaints without re-rendering React. Read it
 * as React state with {@link useTrackValue} only where React must see the
 * value (DOM text, logic).
 *
 * @example
 * ```tsx
 * import { valueTo } from "@sophistry/core";
 * import { Circle, usePlayer, useTrack } from "@sophistry/react";
 * import { useEffect } from "react";
 *
 * function Grow() {
 * 	const radius = useTrack(1);
 * 	const player = usePlayer();
 * 	useEffect(() => void player.play(valueTo(radius, 2)), [player, radius]);
 * 	return <Circle radius={radius} />;
 * }
 * ```
 *
 * @param initial - The starting value.
 * @param options - `equals`, as for `track()`.
 * @returns The track.
 * @category Tracks & clocks
 */
export function useTrack<T>(
	initial: T,
	options?: Parameters<typeof track<T>>[1],
): Track<T> {
	return useState(() => track(initial, options))[0];
}

/**
 * The current value of a `Readable` (a `Track`, a `derive`, `clock.time`, a
 * node's `readable(key)`) as React state: the component re-renders when it
 * changes.
 *
 * For DOM text and logic. To animate a scene node, pass the `Readable` as
 * the prop instead, which costs no render at all.
 *
 * @example
 * ```tsx
 * import { useClock, useTrackValue } from "@sophistry/react";
 *
 * function Elapsed() {
 * 	const time = useTrackValue(useClock().time);
 * 	return <span>{time.toFixed(1)} s</span>;
 * }
 * ```
 *
 * @param source - What to read.
 * @returns Its current value.
 * @category Tracks & clocks
 */
export function useTrackValue<T>(source: Readable<T>): T {
	const subscribe = useCallback(
		(onChange: () => void) => source.subscribe(onChange),
		[source],
	);
	const read = useCallback(() => source.peek(), [source]);
	return useSyncExternalStore(subscribe, read, read);
}

/**
 * The default theme in the page's colour mode, following it: what
 * {@link useTheme} reads outside a stage.
 */
const pageTheme: Readable<Theme> = derive(colorModeReadable, () =>
	resolveTheme(),
);

/**
 * The active theme as React state: the enclosing `<Stage>`'s
 * (`scene.theme`, which follows its `theme`, `palette` and `mode` props), or
 * outside a stage the default palette in the page's colour mode, following
 * it. The component re-renders when it changes.
 *
 * @example
 * ```tsx
 * import { Circle, useTheme } from "@sophistry/react";
 *
 * function Accent() {
 * 	const theme = useTheme();
 * 	return <Circle radius={1} stroke={theme.palette.accent} />;
 * }
 * ```
 *
 * @returns The resolved {@link Theme}.
 * @category Theming
 */
export function useTheme(): Theme {
	return useTrackValue(useContext(SceneContext)?.theme ?? pageTheme);
}

/**
 * `play` and `timeline` bound to a scene and a cancellation signal.
 * Returned by {@link usePlayer}.
 *
 * @category Animation composition & timelines
 */
export interface Player {
	/** The clock runs start on: the scene's, else `defaultClock`. */
	readonly clock: Clock;
	/** Aborts every run started from this player (on unmount, or the `signal` option). */
	readonly signal: AbortSignal;
	/**
	 * Runs animations in parallel and resolves when the longest finishes:
	 * `scene.play(...)` (the scene's clock, reduced motion and lifetime) with
	 * the player's signal. A trailing `PlayContext` overrides the clock and
	 * adds a signal.
	 */
	play(
		...args: Animation[] | [...Animation[], PlayContext]
	): Promise<PlayResult>;
	/** A seekable timeline, as `scene.timeline(...)` with the player's signal. */
	timeline(animation: Animation, context?: PlayContext): Timeline;
}

/**
 * Options for {@link usePlayer}.
 *
 * @category Animation composition & timelines
 */
export interface PlayerOptions {
	/** An additional signal that aborts the player's runs. */
	signal?: AbortSignal;
	/**
	 * The scene to play on, for a component beside the stage (from `<Stage
	 * ref>`; read at each call, so a ref filled later works). Defaults to the
	 * enclosing stage's scene.
	 */
	scene?: Scene | null | { readonly current: Scene | null };
}

/** The scene an option names, if any. */
function sceneOf(option: PlayerOptions["scene"]): Scene | null {
	if (!option) return null;
	return "current" in option ? option.current : option;
}

/**
 * Binds `play` and `timeline` to the enclosing `<Stage>`'s scene (its clock,
 * reduced motion and lifetime) and aborts the runs when the component
 * unmounts. The player is the same object on every render, so it is safe in
 * effect dependencies.
 *
 * Outside a stage, without a `scene` option, runs use the provided clock (`<ClockProvider>`) or `defaultClock`. A component beside the
 * stage can pass the stage's ref: `usePlayer({ scene: stageRef })`.
 *
 * @example
 * ```tsx
 * import { valueTo } from "@sophistry/core";
 * import { Circle, usePlayer, useTrack } from "@sophistry/react";
 * import { useEffect } from "react";
 *
 * function Pulse() {
 * 	const radius = useTrack(1);
 * 	const player = usePlayer();
 * 	useEffect(() => {
 * 		void player.play(valueTo(radius, 2, { duration: 1 }));
 * 	}, [player, radius]);
 * 	return <Circle radius={radius} />;
 * }
 * ```
 *
 * @param options - `signal` and `scene`; see {@link PlayerOptions}.
 * @returns A {@link Player}.
 * @category Animation composition & timelines
 */
export function usePlayer(options: PlayerOptions = {}): Player {
	const enclosing = useContext(SceneContext);
	const provided = useContext(ClockContext) ?? defaultClock;
	const latest = useRef({ enclosing, options, provided });
	latest.current = { enclosing, options, provided };
	const controller = useRef<AbortController | null>(null);

	// Aborted on unmount; a remount (StrictMode, Activity) gets a fresh one.
	useEffect(() => {
		if (controller.current?.signal.aborted) controller.current = null;
		return () => controller.current?.abort();
	}, []);

	const [player] = useState<Player>(() => {
		const signal = (): AbortSignal => {
			controller.current ??= new AbortController();
			return anySignal(
				controller.current.signal,
				latest.current.options.signal,
			) as AbortSignal;
		};
		const scene = () =>
			sceneOf(latest.current.options.scene) ?? latest.current.enclosing;
		const merge = (context: PlayContext = {}): PlayContext => ({
			...context,
			signal: anySignal(signal(), context.signal),
		});
		return {
			get clock() {
				return scene()?.clock ?? latest.current.provided;
			},
			get signal() {
				return signal();
			},
			play(...args) {
				const { animations, context } = splitPlayArguments(args);
				const target = scene();
				if (target) return target.play(...animations, merge(context));
				return play(...animations, {
					clock: latest.current.provided,
					...merge(context),
				});
			},
			timeline(animation, context) {
				const target = scene();
				if (target) return target.timeline(animation, merge(context));
				return timeline(animation, {
					clock: latest.current.provided,
					...merge(context),
				});
			},
		};
	});
	return player;
}

/**
 * A point the user can drag: what {@link useMovablePoint} returns.
 *
 * @category Interaction
 */
export interface MovablePoint {
	/** Where the point is; pass it as the shape's position prop (`center`). */
	readonly position: Track<Point>;
	/**
	 * The drag and keyboard behaviour (`drag`, `keyboard`, `cursor`,
	 * `pointerEvents`) to spread onto the shape: `draggable(position, ...)`.
	 */
	readonly props: DraggableProps;
}

/**
 * A draggable point owned by the component: a `trackPoint` and
 * `draggable(...)` props for it, both made once. Spread `props` onto the
 * shape and pass `position` as its position; dragging writes the track, so
 * the shape follows without re-rendering.
 *
 * `options` are read on the first render, except the callbacks
 * (`onDragStart`, `onDrag`, `onDragEnd`, `onDragOver`), which always call
 * the latest ones.
 *
 * @example
 * ```tsx
 * import { snapToGrid } from "@sophistry/core";
 * import { Circle, useMovablePoint } from "@sophistry/react";
 *
 * function Handle() {
 * 	const { position, props } = useMovablePoint({ x: 1, y: 1 }, { constrain: snapToGrid(0.5) });
 * 	return <Circle center={position} radius={0.2} label="handle" {...props} />;
 * }
 * ```
 *
 * @param initial - Where the point starts.
 * @param options - Projection, constraints, cursor, key steps and callbacks,
 * as for `draggable`.
 * @returns The {@link MovablePoint}.
 * @category Interaction
 */
export function useMovablePoint(
	initial: Point,
	options: DragOptions<Point> = {},
): MovablePoint {
	const latest = useRef(options);
	latest.current = options;
	const [movable] = useState<MovablePoint>(() => {
		const position = trackPoint(initial.x, initial.y);
		const props = draggable(position, {
			...options,
			onDragStart: (value, event) => latest.current.onDragStart?.(value, event),
			onDrag: (value, event) => latest.current.onDrag?.(value, event),
			onDragEnd: (value, event) => latest.current.onDragEnd?.(value, event),
			onDragOver: (target, event) => latest.current.onDragOver?.(target, event),
		});
		return { position, props };
	});
	return movable;
}
