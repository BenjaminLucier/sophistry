/**
 * `<ClockProvider>`: the clock `<Stage>`, `usePlayer` and `useClock` use when
 * none is given.
 */

import type { JSX } from "@solidjs/web";
import type { Clock } from "@sophistry/core";
import { ClockContext } from "./context.js";

/**
 * Props for {@link ClockProvider}.
 *
 * @category Tracks & clocks
 */
export interface ClockProviderProps {
	/** The clock everything below runs on (`createClock()`). Read once. */
	clock: Clock;
	children?: JSX.Element;
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
 * import { Circle, ClockProvider, Stage } from "@sophistry/solidjs";
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
export function ClockProvider(props: ClockProviderProps): JSX.Element {
	return <ClockContext value={props.clock}>{props.children}</ClockContext>;
}
