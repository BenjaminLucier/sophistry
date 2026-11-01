/**
 * Hooks over core's reactive values and the enclosing scene: `useTrack`,
 * `useTrackValue`, `useTheme`, `usePlayer`, `useMovablePoint`. (`useScene` and `useClock`
 * live in `context.ts`.)
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
	isReadable,
	play,
	resolveTheme,
	splitPlayArguments,
	timeline,
	track,
	trackPoint,
} from "@sophistry/core";
import type { Accessor } from "solid-js";
import { createMemo, createSignal, getOwner, onCleanup } from "solid-js";
import { currentClock, currentScene } from "./context.js";

/**
 * A `track()`: a value scene nodes can bind to and animations can write.
 * Exists for symmetry with the React bindings; in Solid a component body runs
 * once, so `track(initial)` in the body is the same thing.
 *
 * Pass the track itself as a prop (`<Circle radius={radius} />`) for
 * per-frame animation: core binds it and no Solid code runs per frame.
 *
 * @param initial - The starting value.
 * @param options - `equals`, as for `track`.
 * @returns A new {@link Track}.
 * @category Tracks & clocks
 */
export function useTrack<T>(
	initial: T,
	options?: { equals?: false | ((a: T, b: T) => boolean) },
): Track<T> {
	return track(initial, options);
}

/**
 * A Solid accessor over a core `Readable` (a `Track`, a `derive`, a node's
 * `readable(key)`, `scene.frame`): for showing a value in DOM or for logic
 * that must re-run in Solid. It subscribes once; a write only bumps a Solid
 * signal (nothing is computed then), and reading the accessor pulls the
 * current value with `peek()`. Unsubscribes when the owner is disposed.
 *
 * Do not use it to feed a scene component: pass the `Readable` itself as the
 * prop, which binds in core with no Solid work per frame.
 *
 * @example
 * ```tsx
 * import { track } from "@sophistry/core";
 * import { useTrackValue } from "@sophistry/solidjs";
 *
 * const radius = track(1);
 *
 * function Readout() {
 * 	const value = useTrackValue(radius);
 * 	return <span>r = {value().toFixed(2)}</span>;
 * }
 * ```
 *
 * @param source - Any {@link Readable}.
 * @returns An accessor of its current value.
 * @category Tracks & clocks
 */
export function useTrackValue<T>(source: Readable<T>): Accessor<T> {
	const [version, setVersion] = createSignal(0);
	const unsubscribe = source.subscribe(() => {
		setVersion((previous) => previous + 1);
	});
	if (getOwner()) onCleanup(unsubscribe);
	return createMemo(() => {
		version();
		return source.peek();
	});
}

/**
 * The default theme in the page's colour mode, following it: what
 * {@link useTheme} reads outside a stage.
 */
const pageTheme: Readable<Theme> = derive(colorModeReadable, () =>
	resolveTheme(),
);

/**
 * The active theme: the enclosing `<Stage>`'s (`scene.theme`, which follows
 * its `theme`, `palette` and `mode` props), or outside a stage the default
 * palette in the page's colour mode, following it. Call it in a component
 * body.
 *
 * For a scene prop that should follow the theme without Solid work, bind a
 * `derive` of `useScene().theme` instead.
 *
 * @example
 * ```tsx
 * import { Circle, useTheme } from "@sophistry/solidjs";
 *
 * function Accent() {
 * 	const theme = useTheme();
 * 	return <Circle radius={1} stroke={theme().palette.accent} />;
 * }
 * ```
 *
 * @returns An accessor of the resolved theme.
 * @category Theming
 */
export function useTheme(): Accessor<Theme> {
	return useTrackValue(currentScene()?.theme ?? pageTheme);
}

/**
 * `play` and `timeline` bound to the enclosing scene and a cancellation
 * signal. Returned by {@link usePlayer}.
 *
 * @category Animation composition & timelines
 */
export interface UsePlayerResult {
	/** The clock the player runs on (the enclosing stage's, else the provided one, else `defaultClock`). */
	readonly clock: Clock;
	/** Aborts every run started from this player (on cleanup, or `options.signal`). */
	readonly signal: AbortSignal;
	/**
	 * `scene.play` with this player's signal. A trailing {@link PlayContext}
	 * overrides the scene's settings for that call and adds a signal: the run
	 * aborts when either the player's or the call's signal does.
	 */
	play(
		...args: Animation[] | [...Animation[], PlayContext]
	): Promise<PlayResult>;
	/** `scene.timeline` with this player's signal; `context` merges as for `play`. */
	timeline(animation: Animation, context?: PlayContext): Timeline;
}

/**
 * Options for {@link usePlayer}.
 *
 * @category Animation composition & timelines
 */
export interface UsePlayerOptions {
	/** An additional signal that aborts the player's runs. */
	signal?: AbortSignal;
}

/**
 * Binds `play` and `timeline` to the enclosing `<Stage>` (its clock, reduced
 * motion and lifetime), and aborts the runs when the component is disposed.
 * Outside a stage the runs use the nearest `<ClockProvider>`'s clock, else `defaultClock`. Call it in a component body;
 * the returned functions work from anywhere (an async script, a handler).
 *
 * @example
 * ```tsx
 * import { fadeIn, track } from "@sophistry/core";
 * import { Circle, usePlayer } from "@sophistry/solidjs";
 * import { onSettled } from "solid-js";
 *
 * function Appear() {
 * 	const opacity = track(0);
 * 	const player = usePlayer();
 * 	onSettled(() => void player.play(fadeIn(opacity)));
 * 	return <Circle radius={1} opacity={opacity} />;
 * }
 * ```
 *
 * @param options - See {@link UsePlayerOptions}.
 * @returns A {@link UsePlayerResult}.
 * @category Animation composition & timelines
 */
export function usePlayer(options: UsePlayerOptions = {}): UsePlayerResult {
	const scene = currentScene();
	const clock = scene?.clock ?? currentClock() ?? defaultClock;
	const controller = new AbortController();
	const signal = anySignal(options.signal, controller.signal) as AbortSignal;
	if (getOwner()) onCleanup(() => controller.abort());
	const merge = (override: PlayContext = {}): PlayContext => ({
		...override,
		signal: anySignal(signal, override.signal),
	});
	return {
		clock,
		signal,
		play: (...args) => {
			const { animations, context } = splitPlayArguments(args);
			return scene
				? scene.play(...animations, merge(context))
				: play(...animations, { clock, ...merge(context) });
		},
		timeline: (animation, context) =>
			scene
				? scene.timeline(animation, merge(context))
				: timeline(animation, { clock, ...merge(context) }),
	};
}

/**
 * Options for {@link useMovablePoint}: core's `DragOptions` for a point
 * (`constrain`, `cursor`, `step`, `onDragStart`, ...).
 *
 * @category Interaction
 */
export type UseMovablePointOptions = DragOptions<Point>;

/**
 * A draggable point. Returned by {@link useMovablePoint}.
 *
 * @category Interaction
 */
export interface UseMovablePointResult {
	/** Where the point is; bind it to the handle's `center` and to anything that follows it. */
	readonly position: Track<Point>;
	/** The drag and keyboard props to spread onto the handle (core's `draggable`). */
	readonly props: DraggableProps;
}

/**
 * A point the user can drag (and nudge with the arrow keys): a
 * `trackPoint` plus core's `draggable` props for it. Spread `props` onto the
 * handle and bind `position` wherever the point is used; dragging writes the
 * track, so everything bound to it follows with no Solid work.
 *
 * @example
 * ```tsx
 * import { onCircle } from "@sophistry/core";
 * import { Circle, Stage, useMovablePoint } from "@sophistry/solidjs";
 *
 * function Handle() {
 * 	const point = useMovablePoint({ x: 2, y: 0 }, { constrain: onCircle({ x: 0, y: 0 }, 2) });
 * 	return <Circle center={point.position} radius={0.15} fill="tomato" label="handle" {...point.props} />;
 * }
 * ```
 *
 * @param initial - The starting point, or a point track to drive.
 * @param options - See {@link UseMovablePointOptions}.
 * @returns A {@link UseMovablePointResult}.
 * @category Interaction
 */
export function useMovablePoint(
	initial: Point | Track<Point>,
	options: UseMovablePointOptions = {},
): UseMovablePointResult {
	const position = isReadable(initial)
		? (initial as Track<Point>)
		: trackPoint(initial.x, initial.y);
	return { position, props: draggable(position, options) };
}
