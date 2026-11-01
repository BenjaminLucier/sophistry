import { describe, expect, it } from "vitest";
import type { SpringSpec, SpringState } from "./spring.js";
import {
	dampingRatio,
	spring,
	springAt,
	springDefaults,
	springEasing,
	springEnergyNorm,
	springProgress,
	springSettleTime,
} from "./spring.js";

/** Integrates the oscillator with classic RK4; the reference for the closed form. */
function integrate(
	spec: SpringSpec,
	displacement: number,
	velocity: number,
	time: number,
	step = 1e-4,
): SpringState {
	const acceleration = (x: number, v: number) =>
		-(spec.stiffness * x + spec.damping * v) / spec.mass;
	let x = displacement;
	let v = velocity;
	const steps = Math.round(time / step);
	const h = time / steps;
	for (let i = 0; i < steps; i++) {
		const k1x = v;
		const k1v = acceleration(x, v);
		const k2x = v + (h / 2) * k1v;
		const k2v = acceleration(x + (h / 2) * k1x, v + (h / 2) * k1v);
		const k3x = v + (h / 2) * k2v;
		const k3v = acceleration(x + (h / 2) * k2x, v + (h / 2) * k2v);
		const k4x = v + h * k3v;
		const k4v = acceleration(x + h * k3x, v + h * k3v);
		x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
		v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
	}
	return { displacement: x, velocity: v };
}

const regimes = {
	under: spring({ stiffness: 100, damping: 4, mass: 1 }),
	critical: spring({ stiffness: 100, damping: 20, mass: 1 }),
	over: spring({ stiffness: 100, damping: 60, mass: 1 }),
	heavy: spring({ stiffness: 40, damping: 9, mass: 2.5 }),
};

describe("spring", () => {
	it("fills defaults and is tagged as a transition spec", () => {
		const spec = spring();
		expect(spec).toEqual({
			type: "spring",
			stiffness: springDefaults.stiffness,
			damping: springDefaults.damping,
			mass: springDefaults.mass,
		});
		expect(Object.isFrozen(spec)).toBe(true);
		expect(dampingRatio(spec)).toBeCloseTo(0.5, 12);
	});

	it("rejects non-positive or non-finite parameters", () => {
		expect(() => spring({ damping: 0 })).toThrow(RangeError);
		expect(() => spring({ damping: -1 })).toThrow(RangeError);
		expect(() => spring({ stiffness: 0 })).toThrow(RangeError);
		expect(() => spring({ mass: Number.NaN })).toThrow(RangeError);
		expect(() => spring({ stiffness: Number.POSITIVE_INFINITY })).toThrow(
			RangeError,
		);
	});
});

describe("springAt", () => {
	for (const [name, spec] of Object.entries(regimes)) {
		it(`matches RK4 integration (${name}, ratio ${dampingRatio(spec).toFixed(2)})`, () => {
			for (const [x0, v0] of [
				[1, 0],
				[-0.7, 3.5],
				[0, -12],
			] as const) {
				for (const t of [0.05, 0.3, 0.8, 1.7]) {
					const exact = springAt(spec, x0, v0, t);
					const reference = integrate(spec, x0, v0, t);
					expect(
						Math.abs(exact.displacement - reference.displacement),
					).toBeLessThan(1e-6);
					expect(Math.abs(exact.velocity - reference.velocity)).toBeLessThan(
						1e-6,
					);
				}
			}
		});
	}

	it("is continuous through critical damping", () => {
		const critical = springAt(regimes.critical, 1, 2, 0.4);
		for (const nudge of [1e-12, 1e-9, 1e-7, 1e-5]) {
			for (const sign of [-1, 1]) {
				const near = spring({
					stiffness: 100,
					damping: 20 * (1 + sign * nudge),
				});
				const state = springAt(near, 1, 2, 0.4);
				expect(state.displacement).toBeCloseTo(critical.displacement, 4);
				expect(state.velocity).toBeCloseTo(critical.velocity, 3);
				expect(Number.isFinite(state.displacement)).toBe(true);
			}
		}
	});

	it("stays finite for stiff, heavily over-damped springs at long times", () => {
		const stiff = spring({ stiffness: 1e6, damping: 1e5, mass: 1 });
		const state = springAt(stiff, 1, 0, 100);
		expect(Number.isFinite(state.displacement)).toBe(true);
		expect(Number.isFinite(state.velocity)).toBe(true);
	});

	it("returns the initial state at t = 0 and for negative times", () => {
		expect(springAt(regimes.under, 0.4, -2, 0)).toEqual({
			displacement: 0.4,
			velocity: -2,
		});
		expect(springAt(regimes.under, 0.4, -2, -1).displacement).toBe(0.4);
	});

	it("writes into `out` when given", () => {
		const out = { displacement: 0, velocity: 0 };
		expect(springAt(regimes.under, 1, 0, 0.2, out)).toBe(out);
	});
});

describe("springSettleTime", () => {
	for (const [name, spec] of Object.entries(regimes)) {
		it(`is exactly where the energy norm drops to restDelta (${name})`, () => {
			const restDelta = 1e-3;
			const settle = springSettleTime(spec, 1, 2, restDelta);
			expect(Number.isFinite(settle)).toBe(true);
			// Densely past it: displacement within restDelta for good.
			for (let i = 0; i <= 2000; i++) {
				const t = settle + i * 0.0025;
				const state = springAt(spec, 1, 2, t);
				expect(Math.abs(state.displacement)).toBeLessThanOrEqual(restDelta);
				expect(springEnergyNorm(spec, state)).toBeLessThanOrEqual(restDelta);
			}
			// Just before it the spring was not yet at rest.
			const before = springAt(spec, 1, 2, settle * (1 - 1e-6));
			expect(springEnergyNorm(spec, before)).toBeGreaterThan(restDelta);
		});
	}

	it("for an under-damped spring, the displacement exceeds restDelta in the last stretch", () => {
		const spec = regimes.under;
		const settle = springSettleTime(spec, 1, 0, 1e-3);
		const period = (2 * Math.PI) / Math.sqrt(100 - 4);
		let peak = 0;
		for (let i = 0; i <= 200; i++) {
			const t = settle - period + (i / 200) * period;
			peak = Math.max(peak, Math.abs(springAt(spec, 1, 0, t).displacement));
		}
		expect(peak).toBeGreaterThan(1e-3 * 0.5);
	});

	it("is 0 when already at rest", () => {
		expect(springSettleTime(regimes.under, 1e-4, 0, 1e-3)).toBe(0);
	});

	it("grows with the initial displacement and shrinks with restDelta", () => {
		const spec = regimes.critical;
		expect(springSettleTime(spec, 10, 0)).toBeGreaterThan(
			springSettleTime(spec, 1, 0),
		);
		expect(springSettleTime(spec, 1, 0, 1e-2)).toBeLessThan(
			springSettleTime(spec, 1, 0, 1e-4),
		);
	});

	it("rejects an invalid restDelta or initial state", () => {
		expect(() => springSettleTime(regimes.under, 1, 0, 0)).toThrow(RangeError);
		expect(() => springSettleTime(regimes.under, Number.NaN, 0)).toThrow(
			RangeError,
		);
	});
});

describe("springProgress", () => {
	it("runs from exactly 0 to exactly 1 and is O(1) to sample anywhere", () => {
		const { duration, progress } = springProgress({ damping: 6 });
		expect(progress(0)).toBe(0);
		expect(progress(duration)).toBe(1);
		expect(progress(duration + 5)).toBe(1);
		expect(progress(-1)).toBe(0);
		// Order-independent: sampling is a pure function of time.
		const late = progress(duration * 0.9);
		const early = progress(duration * 0.3);
		expect(progress(duration * 0.3)).toBe(early);
		expect(progress(duration * 0.9)).toBe(late);
	});

	it("starts with the given velocity, in progress units per second", () => {
		const { progress } = springProgress({ velocity: 5 });
		const h = 1e-6;
		expect(progress(h) / h).toBeCloseTo(5, 2);
	});

	it("rejects a non-finite velocity", () => {
		expect(() => springProgress({ velocity: Number.NaN })).toThrow(RangeError);
	});
});

describe("springEasing", () => {
	it("maps 0 to 0 and 1 to 1 exactly", () => {
		for (const damping of [3, 10, 20, 50]) {
			const ease = springEasing({ damping });
			expect(ease(0)).toBe(0);
			expect(ease(1)).toBe(1);
		}
	});

	it("overshoots when under-damped and not when over-damped", () => {
		const peak = (damping: number) => {
			const ease = springEasing({ damping });
			let highest = 0;
			for (let i = 0; i <= 1000; i++)
				highest = Math.max(highest, ease(i / 1000));
			return highest;
		};
		expect(peak(5)).toBeGreaterThan(1.2);
		expect(peak(40)).toBeLessThanOrEqual(1);
	});

	it("clamps inputs outside 0..1", () => {
		const ease = springEasing();
		expect(ease(-0.5)).toBe(0);
		expect(ease(1.5)).toBe(1);
	});

	it("degenerates to linear when the spring starts at rest", () => {
		const ease = springEasing({ restDelta: 2 });
		expect(ease(0.25)).toBe(0.25);
		expect(ease(1)).toBe(1);
	});
});
