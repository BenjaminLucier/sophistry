/**
 * The Solid context a `<Stage>` provides: its {@link Scene}. Wrapped
 * components and hooks read it at creation time; user contexts from above the
 * stage flow through untouched, since the stage is an ordinary component.
 */

import type { Clock, Scene } from "@sophistry/core";
import { defaultClock } from "@sophistry/core";
import { createContext, getOwner, useContext } from "solid-js";

/**
 * The enclosing stage's scene. `null` (rather than no default) so reading it
 * outside a stage returns null instead of throwing `ContextNotFoundError`.
 *
 * @internal
 */
export const SceneContext = createContext<Scene | null>(null, {
	name: "SceneContext",
});

/**
 * The clock a `<ClockProvider>` provides. `null` outside one.
 *
 * @internal
 */
export const ClockContext = createContext<Clock | null>(null, {
	name: "ClockContext",
});

/**
 * The nearest provided clock, or null outside a `<ClockProvider>` or outside
 * any owner.
 *
 * @internal
 */
export function currentClock(): Clock | null {
	return getOwner() ? useContext(ClockContext) : null;
}

/**
 * The enclosing stage's scene, or null outside a stage or outside any owner
 * (an async continuation).
 *
 * @internal
 */
export function currentScene(): Scene | null {
	return getOwner() ? useContext(SceneContext) : null;
}

/**
 * Reads the scene of the enclosing `<Stage>` (or `<MultiStage>`).
 *
 * Call it in a component body (it needs the owner), then use the scene from
 * anywhere: `scene.frame` for layout, `scene.pointer` for readouts,
 * `scene.addCamera(...)`, `scene.play(...)`.
 *
 * @example
 * ```tsx
 * import { Circle, Stage, useScene } from "@sophistry/solidjs";
 *
 * function TopRight() {
 * 	const scene = useScene();
 * 	const frame = scene.frame.peek();
 * 	return <Circle center={{ x: frame.maxX - 1, y: frame.maxY - 1 }} radius={0.5} />;
 * }
 *
 * export const Figure = () => (
 * 	<Stage units={8}>
 * 		<TopRight />
 * 	</Stage>
 * );
 * ```
 *
 * @returns The enclosing {@link Scene}.
 * @throws When called outside a `<Stage>`.
 * @category Stage & cameras
 */
export function useScene(): Scene {
	const scene = currentScene();
	if (!scene) {
		throw new Error(
			"useScene() must be called in a component rendered inside a <Stage> or <MultiStage>.",
		);
	}
	return scene;
}

/**
 * Reads the clock of the enclosing `<Stage>` (its `clock` prop, else the
 * nearest `<ClockProvider>`'s, else `defaultClock`); outside a stage, the
 * provider's or `defaultClock`.
 *
 * Call it in a component body (it needs the owner). Most scripts want
 * `usePlayer()` instead, which wraps the scene's clock; use `useClock()`
 * directly to show `clock.time` in a playback UI (with `useTrackValue`) or to
 * pass `{ clock }` to a run started elsewhere.
 *
 * @returns The scene's {@link Clock}.
 * @category Tracks & clocks
 */
export function useClock(): Clock {
	return currentScene()?.clock ?? currentClock() ?? defaultClock;
}
