/**
 * Vector fields as geometry: a function from point to vector, and streamlines
 * from integrating it with classical RK4 (Euler spirals outward on rotational
 * fields). Integration stops at a non-finite value, out of bounds, or below
 * `minSpeed`.
 */

import { boundsContain } from "./bounds.js";
import { isFinitePoint } from "./num.js";
import type { Bounds, Point, Polyline } from "./path/types.js";

/**
 * A vector field: the vector at a point, in the caller's own coordinates.
 *
 * @category Fields
 */
export type VectorFn = (at: Point) => Point;

/**
 * Speed below which a particle is treated as stationary. Not a tolerance to
 * tune — it exists so a fixed point terminates the line rather than emitting
 * ten thousand identical anchors.
 */
const DEFAULT_MIN_SPEED = 1e-9;

/** One RK4 step, plus the speed at the current point — both from one pass. */
function advance(
	f: VectorFn,
	at: Point,
	h: number,
): { next: Point; speed: number } | null {
	const k1 = f(at);
	if (!isFinitePoint(k1)) return null;
	const k2 = f({ x: at.x + (k1.x * h) / 2, y: at.y + (k1.y * h) / 2 });
	if (!isFinitePoint(k2)) return null;
	const k3 = f({ x: at.x + (k2.x * h) / 2, y: at.y + (k2.y * h) / 2 });
	if (!isFinitePoint(k3)) return null;
	const k4 = f({ x: at.x + k3.x * h, y: at.y + k3.y * h });
	if (!isFinitePoint(k4)) return null;

	return {
		next: {
			x: at.x + (h / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
			y: at.y + (h / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y),
		},
		speed: Math.hypot(k1.x, k1.y),
	};
}

/**
 * One Runge–Kutta step of `dt` from `at`, or `null` where `f` is not finite.
 *
 * Exposed on its own because a flow is not always a curve: nudging a dot along
 * a field one frame at a time — Manim's `VectorField.nudge` — is this function
 * called with the frame's delta, and wants nothing else from this module.
 *
 * @param f - The vector field.
 * @param at - Current position.
 * @param dt - Time step; negative goes backwards.
 * @returns The new position, or `null` if the field is not finite along the step.
 *
 * @category Fields
 */
export function rk4Step(f: VectorFn, at: Point, dt: number): Point | null {
	return advance(f, at, dt)?.next ?? null;
}

/**
 * Integration settings for {@link streamline} and {@link streamlineBothWays}.
 *
 * @category Fields
 */
export interface StreamlineOptions {
	/** Time step, in the field's own time units. Negative integrates backwards; so does `backward`. */
	dt: number;
	/** Maximum steps taken, and so the anchor count minus one. */
	steps: number;
	/** Stop when a step leaves this box. Unbounded when absent. */
	bounds?: Bounds;
	/** Stop at a speed this low — the flow has reached a fixed point. */
	minSpeed?: number;
	/** Integrate against the flow, tracing where a particle came *from*. */
	backward?: boolean;
}

/**
 * The flow line through `start`, as a polyline in the field's own coordinates.
 *
 * Anchors are the integrator's own steps, so they bunch where the field is slow
 * and spread where it is fast — the spacing *is* the speed, which is most of
 * what a streamline picture is for. A line that leaves `bounds`, hits a
 * singularity, or stalls at a fixed point simply ends there; the result can be
 * shorter than `steps + 1` points, or empty when the seed itself is not finite.
 *
 * @param f - The vector field.
 * @param start - Seed point the line passes through.
 * @param options - Step size, step budget and stopping rules.
 * @returns Anchors from `start` onward, in the field's coordinates.
 *
 * @category Fields
 */
export function streamline(
	f: VectorFn,
	start: Point,
	options: StreamlineOptions,
): Polyline {
	const points: Polyline = [];
	if (!isFinitePoint(start)) return points;

	const h = options.backward ? -options.dt : options.dt;
	const minSpeed = options.minSpeed ?? DEFAULT_MIN_SPEED;
	const steps = Math.max(0, Math.floor(options.steps));
	if (!Number.isFinite(h) || h === 0) return [start];

	let at = start;
	points.push(at);
	for (let i = 0; i < steps; i++) {
		const step = advance(f, at, h);
		if (!step || step.speed <= minSpeed || !isFinitePoint(step.next)) break;
		if (options.bounds && !boundsContain(options.bounds, step.next)) break;
		points.push(step.next);
		at = step.next;
	}
	return points;
}

/**
 * The flow line through `start` in both directions, oldest point first.
 *
 * Seeding forwards alone leaves every line starting on the lattice, which reads
 * as a grid of comets; running the integration backwards as well and joining
 * the two hides the seeds and gives continuous streaks across the field.
 *
 * @param f - The vector field.
 * @param start - Seed point the line passes through.
 * @param options - Step size, step budget and stopping rules; `backward` is ignored.
 * @returns Anchors from the backward end to the forward end.
 *
 * @category Fields
 */
export function streamlineBothWays(
	f: VectorFn,
	start: Point,
	options: StreamlineOptions,
): Polyline {
	// A negative `dt` would swap the two halves and break "oldest point first";
	// only the sign-free step size matters here, direction comes from `backward`.
	const dt = Math.abs(options.dt);
	const forward = streamline(f, start, { ...options, dt, backward: false });
	const backward = streamline(f, start, { ...options, dt, backward: true });
	// `backward[0]` is the seed, which `forward` already carries.
	return [...backward.slice(1).reverse(), ...forward];
}

/**
 * A deterministic value in `[-1, 1)` for sample `index`.
 *
 * Streamline seeds want jitter — an exact lattice makes the eye read rows and
 * columns that the field does not have — but `Math.random` would deal a
 * different picture on every re-render, and this framework's whole claim is
 * that a scene is a pure function of its signals. So the "noise" is a hash of
 * the sample's own index: scattered to look at, identical every time.
 *
 * @param index - Sample index.
 * @param salt - Varies the sequence, e.g. one salt per axis. Defaults to 0.
 * @returns A number in `[-1, 1)`.
 *
 * @category Fields
 */
export function fieldJitter(index: number, salt = 0): number {
	const value = Math.sin(index * 127.1 + salt * 311.7 + 1.0) * 43758.5453;
	return 2 * (value - Math.floor(value)) - 1;
}
