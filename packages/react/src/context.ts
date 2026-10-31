/**
 * The React context carrying the enclosing scene, and the context bridge
 * that carries the user's contexts across the renderer boundary.
 *
 * A `<Stage>`'s children render through a second reconciler, and React
 * contexts do not cross renderers: a provider above the `<Stage>` (a theme,
 * a router, a store) is invisible below it. The bridge is `its-fine`'s
 * `useContextBridge` (the one react-three-fiber uses): it finds the context
 * providers above the stage by walking its fiber's ancestors, reads each
 * one's current value with `use(context)` in the stage's own render (so a
 * change re-renders the stage like any consumer), and returns a component
 * that re-provides them around the children inside the Sophistry root.
 *
 * `its-fine` needs a `FiberProvider` above the hook; `<Stage>` renders its
 * own, so apps need no wrapper.
 */

import type { Clock, Scene } from "@sophistry/core";
import type { ContextBridge } from "its-fine";
import { createContext, createElement, type ReactNode } from "react";

/**
 * The scene of the enclosing `<Stage>`, or null outside one.
 *
 * @internal
 */
export const SceneContext = createContext<Scene | null>(null);
SceneContext.displayName = "SophistryScene";

/**
 * Wraps `children` in the bridged contexts (`Bridge`, from `its-fine`'s
 * `useContextBridge`) and, innermost so it wins over an outer stage's, the
 * scene context.
 *
 * @internal
 */
export function bridge(
	Bridge: ContextBridge,
	scene: Scene,
	children: ReactNode,
): ReactNode {
	return createElement(
		Bridge,
		null,
		createElement(SceneContext, { value: scene }, children),
	);
}

/**
 * The clock a {@link ClockProvider} provides, or null: what `<Stage>`,
 * `usePlayer` and `useClock` use when no `clock` is given.
 *
 * @internal
 */
export const ClockContext = createContext<Clock | null>(null);
ClockContext.displayName = "SophistryClock";

/**
 * Props for {@link ClockProvider}.
 *
 * @category Tracks & clocks
 */
export interface ClockProviderProps {
	/** The clock everything below runs on (`createClock()`). */
	clock: Clock;
	children?: ReactNode;
}

/**
 * Makes `clock` the default clock below it: a `<Stage>` without a `clock`
 * prop, `usePlayer()` and `useClock()` use the nearest provided clock
 * instead of the shared `defaultClock`. A stage's own `clock` prop still
 * wins. Use it to give a whole example or widget (stage, controls, scripts)
 * one clock to pause, speed up or advance by hand.
 *
 * @example
 * ```tsx
 * import { createClock } from "@sophistry/core";
 * import { Circle, ClockProvider, Stage, useClock } from "@sophistry/react";
 *
 * const clock = createClock();
 *
 * export const Figure = () => (
 * 	<ClockProvider clock={clock}>
 * 		<Stage>
 * 			<Circle radius={1} />
 * 		</Stage>
 * 	</ClockProvider>
 * );
 * ```
 *
 * @param props - See {@link ClockProviderProps}.
 * @returns The provider element.
 * @category Tracks & clocks
 */
export function ClockProvider(props: ClockProviderProps): ReactNode {
	return createElement(ClockContext, { value: props.clock }, props.children);
}
