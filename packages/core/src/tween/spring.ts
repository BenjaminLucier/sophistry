/**
 * Springs as closed-form maths: the damped harmonic oscillator
 * `mass * x'' + damping * x' + stiffness * x = 0`, where `x` is the
 * displacement from the rest point. Every function here is O(1) in time
 * (except {@link springSettleTime}, which bisects once per spring) and pure,
 * so a spring can be *seeked* like any other animation instead of being
 * integrated frame by frame. `anim/spring.ts` builds the verbs (`springTo`,
 * `follow`) on top.
 *
 * One formulation covers the under-, critically- and over-damped cases.
 * Writing `decay = damping / (2 * mass)`, `omega² = stiffness / mass` and
 * `q = omega² - decay²`, the solution is
 *
 * ```
 * x(t) = x0 * C(t) + (v0 + decay * x0) * S(t)
 * v(t) = v0 * C(t) - (decay * v0 + omega² * x0) * S(t)
 * ```
 *
 * with `C = e^(-decay t) cos(√q t)` and `S = e^(-decay t) sin(√q t) / √q`
 * (cosh/sinh when `q < 0`). Near critical damping (`q t²` tiny) both are
 * evaluated by their Taylor series in `q t²`, so there is no `0 / 0` and no
 * jump between the three regimes: a damping ratio of `1 ± 1e-12` gives the
 * same curve as exactly `1`. In the over-damped case the two exponentials are
 * combined before multiplying, so a stiff, heavily damped spring never
 * computes `Infinity * 0`.
 */

import type { EasingFunction } from "./easing";

/**
 * Physical parameters of a spring, plus the start velocity and rest threshold
 * a verb needs. Every field is optional; see {@link springDefaults}.
 *
 * @category Springs
 */
export interface SpringOptions {
	/**
	 * Spring constant: how hard it pulls toward the target. Higher is faster.
	 * Must be positive and finite.
	 * @default 100
	 */
	stiffness?: number;
	/**
	 * Friction: how quickly motion dies out. Below `2 * sqrt(stiffness * mass)`
	 * (critical damping) the spring overshoots and oscillates. Must be positive
	 * and finite; an undamped spring never settles, so it has no duration.
	 * @default 10
	 */
	damping?: number;
	/**
	 * Inertia of the moving value. Heavier is slower and swings further.
	 * Must be positive and finite.
	 * @default 1
	 */
	mass?: number;
	/**
	 * Initial velocity in **progress units per second** (1 means "the whole
	 * distance per second" toward the target; negative starts by moving
	 * away). Used by `springTo` and {@link springEasing}; `follow` starts at
	 * rest and ignores it.
	 * @default 0
	 */
	velocity?: number;
	/**
	 * Rest threshold: the spring counts as settled once
	 * `sqrt(displacement² + (velocity / omega)²) <= restDelta` (see
	 * {@link springSettleTime}). In progress units for `springTo`,
	 * {@link springEasing} and progress-space followers; in value units for
	 * numeric followers. Must be positive and finite.
	 * @default 0.001
	 */
	restDelta?: number;
}

/**
 * A resolved spring: the transition spec form, with defaults filled in and
 * the values validated. Built by {@link spring}; usable wherever a transition
 * accepts a spring.
 *
 * @category Springs
 */
export interface SpringSpec {
	/** Discriminant, so transition specs can be told apart. */
	readonly type: "spring";
	/** Spring constant; see {@link SpringOptions.stiffness}. */
	readonly stiffness: number;
	/** Friction; see {@link SpringOptions.damping}. */
	readonly damping: number;
	/** Inertia; see {@link SpringOptions.mass}. */
	readonly mass: number;
}

/**
 * The defaults every spring option falls back to: a lively but quickly
 * settling spring (damping ratio 0.5, about 16% overshoot, settled in a little
 * over a second from rest).
 *
 * @category Springs
 */
export const springDefaults: Readonly<Required<SpringOptions>> = Object.freeze({
	stiffness: 100,
	damping: 10,
	mass: 1,
	velocity: 0,
	restDelta: 0.001,
});

/** Throws a `RangeError` unless `value` is positive and finite. */
function positive(name: string, value: number): number {
	if (!(Number.isFinite(value) && value > 0)) {
		throw new RangeError(
			`spring: ${name} must be a positive, finite number (got ${value}).`,
		);
	}
	return value;
}

/**
 * Builds a validated {@link SpringSpec} from {@link SpringOptions}, filling
 * in {@link springDefaults}. `velocity` and `restDelta` are not part of the
 * spec (they belong to one run, not to the spring).
 *
 * @param options - Stiffness, damping and mass; missing ones take the defaults.
 * @returns The frozen spec.
 * @throws `RangeError` if stiffness, damping or mass is not positive and finite.
 *
 * @example
 * ```ts
 * import { spring } from "@sophistry/core";
 *
 * const bouncy = spring({ stiffness: 180, damping: 8 });
 * ```
 *
 * @category Springs
 */
export function spring(options: SpringOptions = {}): SpringSpec {
	return Object.freeze({
		type: "spring",
		stiffness: positive(
			"stiffness",
			options.stiffness ?? springDefaults.stiffness,
		),
		damping: positive("damping", options.damping ?? springDefaults.damping),
		mass: positive("mass", options.mass ?? springDefaults.mass),
	});
}

/**
 * Resolves the rest threshold of `options`, validated.
 *
 * @param options - Options carrying an optional `restDelta`.
 * @returns `options.restDelta`, or {@link springDefaults}' `restDelta`.
 * @throws `RangeError` if it is not positive and finite.
 *
 * @category Springs
 */
export function springRestDelta(options: SpringOptions = {}): number {
	return positive("restDelta", options.restDelta ?? springDefaults.restDelta);
}

/**
 * The damping ratio `damping / (2 * sqrt(stiffness * mass))`: below 1 the
 * spring overshoots (under-damped), at 1 it is critically damped (the fastest
 * approach with no overshoot from rest), above 1 it creeps in (over-damped).
 *
 * @param spec - The spring.
 * @returns The dimensionless damping ratio.
 *
 * @category Springs
 */
export function dampingRatio(spec: SpringSpec): number {
	return spec.damping / (2 * Math.sqrt(spec.stiffness * spec.mass));
}

/**
 * The undamped angular frequency `sqrt(stiffness / mass)`, in radians per
 * second. It is also the scale that turns a velocity into a displacement in
 * the settle criterion.
 *
 * @param spec - The spring.
 * @returns The natural frequency in rad/s.
 *
 * @category Springs
 */
export function naturalFrequency(spec: SpringSpec): number {
	return Math.sqrt(spec.stiffness / spec.mass);
}

/**
 * State of a spring at one instant, relative to its rest point.
 *
 * @category Springs
 */
export interface SpringState {
	/** Signed distance from the rest point (the target). */
	displacement: number;
	/** Rate of change of the displacement, per second. */
	velocity: number;
}

/** Below this `|q t²|` the trigonometric forms are replaced by their series. */
const SERIES_LIMIT = 1e-2;

/**
 * Exact state of a spring `time` seconds after it was released with
 * `displacement` and `velocity`. O(1); there is no integration error to
 * accumulate, so it can be called at any time in any order.
 *
 * @param spec - The spring.
 * @param displacement - Initial displacement from the target.
 * @param velocity - Initial velocity, in displacement units per second.
 * @param time - Seconds since release; negative times are treated as 0.
 * @param out - Optional object to write into instead of allocating one.
 * @returns The displacement and velocity at `time` (`out` when given).
 *
 * @example
 * ```ts
 * import { spring, springAt } from "@sophistry/core";
 *
 * // A value 100 px past its target, released at rest, a quarter second later:
 * const { displacement, velocity } = springAt(spring(), 100, 0, 0.25);
 * ```
 *
 * @category Springs
 */
export function springAt(
	spec: SpringSpec,
	displacement: number,
	velocity: number,
	time: number,
	out: SpringState = { displacement: 0, velocity: 0 },
): SpringState {
	const t = time > 0 ? time : 0;
	const omegaSquared = spec.stiffness / spec.mass;
	const decay = spec.damping / (2 * spec.mass);
	const q = omegaSquared - decay * decay;
	const z = q * t * t;
	// `cosine` and `sine` already include the decaying exponential.
	let cosine: number;
	let sine: number;
	if (Math.abs(z) < SERIES_LIMIT) {
		const envelope = Math.exp(-decay * t);
		cosine = envelope * (1 - (z / 2) * (1 - (z / 12) * (1 - z / 30)));
		sine = envelope * t * (1 - (z / 6) * (1 - (z / 20) * (1 - z / 42)));
	} else if (q > 0) {
		const frequency = Math.sqrt(q);
		const envelope = Math.exp(-decay * t);
		cosine = envelope * Math.cos(frequency * t);
		sine = (envelope * Math.sin(frequency * t)) / frequency;
	} else {
		const spread = Math.sqrt(-q);
		// `spread - decay`, written without the cancellation it has when the
		// spring is heavily over-damped.
		const slow = Math.exp((-omegaSquared / (decay + spread)) * t);
		const fast = Math.exp(-(decay + spread) * t);
		cosine = (slow + fast) / 2;
		sine = (slow - fast) / (2 * spread);
	}
	out.displacement =
		displacement * cosine + (velocity + decay * displacement) * sine;
	out.velocity =
		velocity * cosine - (decay * velocity + omegaSquared * displacement) * sine;
	return out;
}

/**
 * The spring's distance from rest in the energy sense:
 * `sqrt(displacement² + (velocity / omega)²)`, where `omega` is the
 * {@link naturalFrequency}. Proportional to the square root of the total
 * (kinetic plus potential) energy, which damping only ever removes, so once
 * this is below a threshold it stays below it.
 *
 * @param spec - The spring.
 * @param state - Displacement and velocity.
 * @returns The energy norm, in displacement units.
 *
 * @category Springs
 */
export function springEnergyNorm(spec: SpringSpec, state: SpringState): number {
	const scaled = state.velocity / naturalFrequency(spec);
	return Math.sqrt(state.displacement * state.displacement + scaled * scaled);
}

/** Bisection steps; 2^-100 of the bracket is far below a float's resolution. */
const BISECTION_STEPS = 100;

/**
 * How long a spring released with `displacement` and `velocity` takes to come
 * to rest: the earliest time at which its {@link springEnergyNorm} is at most
 * `restDelta`.
 *
 * Because damping only removes energy, the norm never rises again, so from
 * that time on `|displacement| <= restDelta` and
 * `|velocity| <= omega * restDelta` hold forever. That makes the criterion
 * slightly stricter than "the displacement stays within `restDelta`" (an
 * under-damped spring passing the target fast is not at rest), and it makes
 * the answer exact: a doubling search brackets the crossing and bisection
 * pins it down. The result depends only on the spring and the initial state,
 * never on the values being animated.
 *
 * @param spec - The spring (positive damping, so the answer is finite).
 * @param displacement - Initial displacement from the target.
 * @param velocity - Initial velocity, in displacement units per second.
 * @param restDelta - The rest threshold, positive.
 * @returns Seconds until rest; 0 if already within `restDelta`.
 * @throws `RangeError` if `restDelta` is not positive and finite, or the
 *   initial state is not finite.
 *
 * @category Springs
 */
export function springSettleTime(
	spec: SpringSpec,
	displacement: number,
	velocity: number,
	restDelta: number = springDefaults.restDelta,
): number {
	positive("restDelta", restDelta);
	if (!(Number.isFinite(displacement) && Number.isFinite(velocity))) {
		throw new RangeError(
			`springSettleTime: the initial state must be finite (got ${displacement}, ${velocity}).`,
		);
	}
	const state: SpringState = { displacement: 0, velocity: 0 };
	const settledAt = (time: number) =>
		springEnergyNorm(
			spec,
			springAt(spec, displacement, velocity, time, state),
		) <= restDelta;
	if (settledAt(0)) return 0;
	// Bracket: grow by doubling from the natural period's scale. Positive
	// damping guarantees the energy decays, so this terminates.
	let low = 0;
	let high = 1 / naturalFrequency(spec);
	while (!settledAt(high)) {
		low = high;
		high *= 2;
	}
	for (let step = 0; step < BISECTION_STEPS && high - low > 0; step++) {
		const middle = (low + high) / 2;
		if (middle <= low || middle >= high) break;
		if (settledAt(middle)) high = middle;
		else low = middle;
	}
	return high;
}

/**
 * A fixed-length spring run in progress units, as used by `springTo` and
 * {@link springEasing}.
 *
 * @category Springs
 */
export interface SpringProgress {
	/** Seconds until rest ({@link springSettleTime} of the run). */
	readonly duration: number;
	/**
	 * Progress at `time` seconds: 0 at the start, exactly 1 from `duration`
	 * on, possibly outside 0..1 in between (overshoot). Times are clamped to
	 * `[0, duration]`.
	 */
	progress(time: number): number;
}

/**
 * Solves a spring that carries progress from 0 to 1, released with
 * `options.velocity` (progress units per second), and returns its settle time
 * and its progress curve.
 *
 * The raw solution ends within `restDelta` of 1, not on it. The curve is
 * corrected by a linear ramp, `p(t) = 1 + x(t) - (t / duration) * x(duration)`,
 * which lands on exactly 1 at `duration`, is continuous, and moves the curve
 * by at most `restDelta` anywhere.
 *
 * @param options - Spring parameters, `velocity` and `restDelta`.
 * @returns The duration and an O(1) progress function.
 * @throws `RangeError` for invalid options (see {@link spring}).
 *
 * @category Springs
 */
export function springProgress(options: SpringOptions = {}): SpringProgress {
	const spec = spring(options);
	const velocity = options.velocity ?? springDefaults.velocity;
	if (!Number.isFinite(velocity)) {
		throw new RangeError(`spring: velocity must be finite (got ${velocity}).`);
	}
	const duration = springSettleTime(
		spec,
		-1,
		velocity,
		springRestDelta(options),
	);
	const state: SpringState = { displacement: 0, velocity: 0 };
	const residual =
		duration > 0
			? springAt(spec, -1, velocity, duration, state).displacement
			: 0;
	return {
		duration,
		progress(time) {
			if (!(time > 0)) return 0;
			if (time >= duration) return 1;
			const { displacement } = springAt(spec, -1, velocity, time, state);
			return 1 + displacement - (time / duration) * residual;
		},
	};
}

/**
 * An {@link EasingFunction} with the shape of a spring: the spring's progress
 * curve stretched so that its settle time maps to 1. `ease(0) = 0` and
 * `ease(1) = 1` exactly; an under-damped spring overshoots past 1 in between.
 * The physical timing is lost (the animation's own `duration` sets the pace);
 * use `springTo` to keep it. Inputs outside 0..1 are clamped.
 *
 * @param options - Spring parameters, `velocity` and `restDelta`.
 * @returns The easing.
 * @throws `RangeError` for invalid options (see {@link spring}).
 *
 * @example
 * ```ts
 * import { driveTrack, springEasing, track } from "@sophistry/core";
 *
 * const x = track(0);
 * const slide = driveTrack(x, 100, { duration: 0.6, easing: springEasing({ damping: 8 }) });
 * ```
 *
 * @category Easing
 */
export function springEasing(options: SpringOptions = {}): EasingFunction {
	const { duration, progress } = springProgress(options);
	if (duration === 0) return (t) => (t >= 1 ? 1 : t > 0 ? t : 0);
	return (t) => (t >= 1 ? 1 : progress(t * duration));
}
