import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Point } from "../geometry";
import { parallel, sequence } from "./sequence";
import {
	arcMotion,
	circleSlots,
	createSlots,
	gridSlots,
	type Motion,
	rowSlots,
	type SlotPlan,
	type Slots,
} from "./slots";
import { timeline } from "./timeline";
import type { Animation } from "./types";

beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
});

const layout = rowSlots({ spacing: 2 });
const make = (keys: string[], extra = {}) =>
	createSlots(keys, { layout, duration: 1, easing: "linear", ...extra });

describe("layouts", () => {
	it("rowSlots centres by default and can pin the start", () => {
		expect(rowSlots({ spacing: 2 })(0, 3)).toEqual({ x: -2, y: 0 });
		expect(rowSlots({ spacing: 2 })(2, 3)).toEqual({ x: 2, y: 0 });
		expect(rowSlots({ align: "start", spacing: 2, x: 1, y: 3 })(2, 9)).toEqual({
			x: 5,
			y: 3,
		});
	});
	it("gridSlots is row-major, rows downward, centred", () => {
		const g = gridSlots({ columns: 2, columnSpacing: 2, rowSpacing: 1 });
		expect(g(0, 4)).toEqual({ x: -1, y: 0.5 });
		expect(g(3, 4)).toEqual({ x: 1, y: -0.5 });
	});
	it("circleSlots starts at the top and goes clockwise", () => {
		const c = circleSlots({ radius: 2 });
		const p0 = c(0, 4);
		const p1 = c(1, 4);
		expect(p0.x).toBeCloseTo(0);
		expect(p0.y).toBeCloseTo(2);
		expect(p1.x).toBeCloseTo(2);
		expect(p1.y).toBeCloseTo(0);
	});
});

describe("model", () => {
	it("starts with items at their layout points", () => {
		const s = make(["a", "b", "c"]);
		expect(s.order.peek()).toEqual(["a", "b", "c"]);
		expect(s.item("c")?.position.peek()).toEqual({ x: 2, y: 0 });
		expect(s.slotOf("b")).toBe(1);
		expect(s.has("z")).toBe(false);
		expect(s.items.peek().map((i) => i.key)).toEqual(["a", "b", "c"]);
		expect(s.positionOf(1)).toEqual({ x: 0, y: 0 });
	});
	it("rejects duplicate keys", () => {
		expect(() => createSlots(["a", "a"])).toThrow(/unique/);
	});
});

describe("operations", () => {
	it("swap moves two items and flips the order at the end", () => {
		const s = make(["a", "b", "c"]);
		const swap = s.plan().swap("a", "c");
		const tl = timeline(swap);
		tl.seek(0.5);
		expect(s.item("a")?.position.peek().x).toBeCloseTo(0);
		expect(s.item("c")?.position.peek().x).toBeCloseTo(0);
		expect(s.order.peek()).toEqual(["a", "b", "c"]);
		tl.seek(1);
		expect(s.order.peek()).toEqual(["c", "b", "a"]);
		expect(s.item("a")?.position.peek()).toEqual({ x: 2, y: 0 });
		expect(s.item("c")?.position.peek()).toEqual({ x: -2, y: 0 });
		// b did not move and gets no motion.
		expect(s.item("b")?.position.peek()).toEqual({ x: 0, y: 0 });
		tl.seek(0);
		expect(s.order.peek()).toEqual(["a", "b", "c"]);
		expect(s.item("a")?.position.peek()).toEqual({ x: -2, y: 0 });
	});

	it("commit: start flips the order immediately", () => {
		const s = make(["a", "b"]);
		const tl = timeline(s.plan().swap("a", "b", { commit: "start" }));
		tl.seek(0.2);
		expect(s.order.peek()).toEqual(["b", "a"]);
		tl.seek(0);
		expect(s.order.peek()).toEqual(["b", "a"]);
	});

	it("plan.order is the working copy and ops chain against it", () => {
		const s = make(["a", "b", "c", "d"]);
		const p = s.plan();
		p.swapAt(0, 3);
		expect(p.order).toEqual(["d", "b", "c", "a"]);
		p.move("a", 0);
		expect(p.order).toEqual(["a", "d", "b", "c"]);
		p.rotate(1);
		expect(p.order).toEqual(["c", "a", "d", "b"]);
		p.rotate(-1);
		expect(p.order).toEqual(["a", "d", "b", "c"]);
		p.permute(["b", "a", "d", "c"]);
		expect(p.indexOf("b")).toBe(0);
		expect(s.order.peek()).toEqual(["a", "b", "c", "d"]); // nothing played
	});

	it("validates arguments", () => {
		const p = make(["a", "b"]).plan();
		expect(() => p.swap("a", "z")).toThrow(/not in the order/);
		expect(() => p.swapAt(0, 5)).toThrow(RangeError);
		expect(() => p.permute(["a"])).toThrow(/exactly the keys/);
		expect(() => p.permute(["a", "a"])).toThrow(/exactly the keys/);
		expect(() => p.insert("a")).toThrow(/already/);
		expect(() => p.move("a", 2)).toThrow(RangeError);
	});

	it("a custom motion decides how items travel, with explicit endpoints", () => {
		const calls: string[] = [];
		const motion: Motion<string> = (key, from, to, ctx) => {
			calls.push(
				`${key} ${from.x}->${to.x} slot ${ctx.fromSlot}->${ctx.toSlot}`,
			);
			return parallel();
		};
		const s = make(["a", "b"], { motion });
		s.plan().swap("a", "b");
		expect(calls.sort()).toEqual(["a -1->1 slot 0->1", "b 1->-1 slot 1->0"]);
	});

	it("arcMotion bulges to the left of travel and ends exactly on target", () => {
		const s = make(["a", "b"], { motion: arcMotion({ bend: 0.5 }) });
		const tl = timeline(s.plan().swap("a", "b"));
		tl.seek(0.5);
		// a travels +x: left is +y; b travels -x: left is -y.
		expect(s.item("a")?.position.peek().y).toBeCloseTo(1);
		expect(s.item("b")?.position.peek().y).toBeCloseTo(-1);
		tl.seek(1);
		expect(s.item("a")?.position.peek()).toEqual({ x: 1, y: 0 });
	});

	it("lag offsets item starts", () => {
		const s = make(["a", "b", "c"]);
		const a = s.plan().rotate(1, { lag: 0.5 });
		expect(a.duration).toBe(1 + 2 * 0.5);
	});

	it("insert opens a gap, then enters; remove exits, then closes", () => {
		const s = make(["a", "b"]);
		const p = s.plan();
		const ins = p.insert("x", 1);
		const rem = p.remove("a");
		const tl = timeline(sequence(ins, rem));
		// Gap opening: b moves from 0 to (count 3) 2.
		tl.seek(0.5);
		expect(s.has("x")).toBe(false);
		expect(s.item("b")?.position.peek().x).toBeCloseTo(1.5); // 1 -> 2, halfway
		tl.seek(1.5);
		expect(s.order.peek()).toEqual(["a", "x", "b"]);
		expect(s.item("x")?.opacity.peek()).toBeCloseTo(0.5);
		tl.seek(2);
		expect(s.item("x")?.opacity.peek()).toBe(1);
		tl.seek(2.5);
		expect(s.has("a")).toBe(true);
		expect(s.item("a")?.opacity.peek()).toBeCloseTo(0.5);
		tl.seek(3.5);
		expect(s.order.peek()).toEqual(["x", "b"]);
		expect(s.items.peek().map((i) => i.key)).toEqual(["b", "x"]);
		tl.seek(0);
		expect(s.order.peek()).toEqual(["a", "b"]);
		expect(s.has("x")).toBe(false);
		expect(s.item("a")?.opacity.peek()).toBe(1);
	});

	it("items outlive removal and can be re-inserted elsewhere", () => {
		const s = make(["a", "b", "c"]);
		const p = s.plan();
		const tl = timeline(sequence(p.remove("a"), p.insert("a", 2)));
		tl.seek(tl.duration);
		expect(s.order.peek()).toEqual(["b", "c", "a"]);
		expect(s.item("a")?.position.peek()).toEqual({ x: 2, y: 0 });
		expect(s.item("a")?.opacity.peek()).toBe(1);
		tl.seek(0);
		expect(s.order.peek()).toEqual(["a", "b", "c"]);
		expect(s.item("a")?.position.peek()).toEqual({ x: -2, y: 0 });
	});

	it("a circle layout reflows everyone on insert", () => {
		const s = createSlots(["a", "b", "c"], {
			layout: circleSlots({ radius: 2 }),
			duration: 1,
			easing: "linear",
		});
		const tl = timeline(s.plan().insert("d", 3));
		tl.seek(tl.duration);
		const b = s.item("b")?.position.peek() as Point;
		expect(b.x).toBeCloseTo(2);
		expect(b.y).toBeCloseTo(0); // 4 slots: b is a quarter turn round
	});
});

/** Everything observable about the model, to compare two runs. */
function observe(s: Slots<string>, keys: string[]) {
	return {
		order: [...s.order.peek()],
		items: s.items.peek().map((i) => i.key),
		// Tracks of absent items are invisible state (an enter's restore parks them
		// at its start values), so only present items are compared.
		state: keys
			.filter((k) => s.has(k))
			.map((k) => {
				const it = s.item(k);
				return [
					k,
					it?.position.peek(),
					it?.opacity.peek(),
					it?.scale.peek(),
					s.slotOf(k),
				];
			}),
	};
}

/** A deterministic PRNG so failures reproduce. */
function rng(seed: number) {
	let x = seed;
	return () => {
		x = (x * 1664525 + 1013904223) % 4294967296;
		return x / 4294967296;
	};
}

/** Builds the same random script of operations (with decoys) on a fresh model. */
function script(seed: number) {
	const rand = rng(seed);
	const keys = ["a", "b", "c", "d", "e"];
	const s = createSlots(keys, {
		layout: rowSlots({ spacing: 2 }),
		duration: 0.7,
		motion: arcMotion({ bend: 0.3 }),
	});
	const p: SlotPlan<string> = s.plan();
	const steps: Animation[] = [];
	const outside = ["x", "y", "z"];
	for (let n = 0; n < 24; n++) {
		const len = p.order.length;
		const pick = Math.floor(rand() * 6);
		const at = (m: number) => Math.floor(rand() * m);
		if (pick === 0 && len > 1) steps.push(p.swapAt(at(len), at(len)));
		else if (pick === 1 && len > 1)
			steps.push(p.move(p.order[at(len)] as string, at(len)));
		else if (pick === 2 && len > 1) steps.push(p.rotate(at(5) - 2));
		else if (pick === 3 && len > 2) {
			const shuffled = [...p.order].sort(() => rand() - 0.5);
			steps.push(p.permute(shuffled, { lag: 0.1 }));
		} else if (pick === 4 && len < 7) {
			const free = outside.filter((k) => p.indexOf(k) < 0);
			const revive = keys.filter((k) => p.indexOf(k) < 0 && s.item(k));
			const k = (revive.length ? revive : free)[0];
			if (k !== undefined) steps.push(p.insert(k, at(len + 1)));
		} else if (pick === 5 && len > 3) {
			steps.push(p.remove(p.order[at(len)] as string));
		}
	}
	const all = [...keys, ...outside];
	return { s, all, anim: sequence(...steps) };
}

describe("seek exactness", () => {
	it.each([1, 2, 3, 4, 5, 6, 7, 8])(
		"scrubbing back and forth matches a fresh forward seek (seed %i)",
		(seed) => {
			const scrubbed = script(seed);
			const tl = timeline(scrubbed.anim);
			const rand = rng(seed * 977);
			const dur = tl.duration;
			expect(dur).toBeGreaterThan(0);
			for (let i = 0; i < 60; i++) {
				const t = i % 7 === 0 ? (i % 2 ? dur : 0) : rand() * dur;
				tl.seek(t);
				const fresh = script(seed);
				timeline(fresh.anim).seek(t);
				expect(
					observe(scrubbed.s, scrubbed.all),
					`seed ${seed} t=${t}`,
				).toEqual(observe(fresh.s, fresh.all));
			}
		},
	);

	it("the end state is the planned order laid out, and 0 is the start", () => {
		const { s, anim } = script(11);
		const tl = timeline(anim);
		const start = observe(s, ["a", "b", "c", "d", "e"]);
		tl.seek(tl.duration);
		const order = [...s.order.peek()];
		order.forEach((k, i) => {
			expect(s.item(k)?.position.peek().x).toBeCloseTo(
				layout(i, order.length).x,
			);
		});
		tl.seek(0);
		expect(observe(s, ["a", "b", "c", "d", "e"])).toEqual(start);
	});

	it("interleaves with other animations and plays through a clock", () => {
		const s = make(["a", "b"]);
		const p = s.plan();
		const tl = timeline(sequence(p.swap("a", "b"), p.swap("a", "b")));
		tl.seek(1.5);
		expect(s.order.peek()).toEqual(["b", "a"]);
		tl.seek(2);
		expect(s.order.peek()).toEqual(["a", "b"]);
	});
});

describe("plan integrity", () => {
	it("rotate rejects non-integer and non-finite shifts without touching the plan", () => {
		const p = make(["a", "b", "c"]).plan();
		for (const by of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
			expect(() => p.rotate(by)).toThrow(RangeError);
		}
		expect(p.order).toEqual(["a", "b", "c"]);
		p.rotate(1);
		expect(p.order).toEqual(["c", "a", "b"]);
	});

	it("every index argument must be an integer", () => {
		const p = make(["a", "b", "c"]).plan();
		expect(() => p.swapAt(0.5, 1)).toThrow(RangeError);
		expect(() => p.swapAt(Number.NaN, 1)).toThrow(RangeError);
		expect(() => p.move("a", 1.5)).toThrow(RangeError);
		expect(() => p.insert("z", Number.NaN)).toThrow(RangeError);
		expect(() => p.insert("z", 0.5)).toThrow(RangeError);
		expect(p.order).toEqual(["a", "b", "c"]);
	});

	it("a throwing motion does not advance the plan", () => {
		const p = make(["a", "b", "c"]).plan();
		const motion: Motion<string> = () => {
			throw new Error("bad motion");
		};
		expect(() => p.swapAt(0, 1, { motion })).toThrow("bad motion");
		expect(p.order).toEqual(["a", "b", "c"]);
		expect(() => p.rotate(1, { motion })).toThrow("bad motion");
		expect(p.order).toEqual(["a", "b", "c"]);
	});

	it("a throwing enter or exit does not advance the plan", () => {
		const s = make(["a", "b"]);
		const p = s.plan();
		const boom = () => {
			throw new Error("bad hook");
		};
		expect(() => p.insert("z", 1, { enter: boom })).toThrow("bad hook");
		expect(p.order).toEqual(["a", "b"]);
		expect(s.has("z")).toBe(false);
		expect(() => p.remove("a", { exit: boom })).toThrow("bad hook");
		expect(p.order).toEqual(["a", "b"]);
		// The plan is still usable.
		expect(() => p.insert("z", 1)).not.toThrow();
		expect(p.order).toEqual(["a", "z", "b"]);
	});
});

describe("replay", () => {
	it("replaying from the end rewinds every later step, not only the first", async () => {
		const s = make(["a", "b", "c"]);
		const plan = s.plan();
		const { createClock } = await import("../tween/clock");
		const clock = createClock();
		const tl = timeline(sequence(plan.swapAt(0, 1), plan.swapAt(1, 2)), {
			clock,
		});
		const first = tl.play();
		clock.advance(2);
		await first;
		expect(s.order.peek()).toEqual(["b", "c", "a"]);
		void tl.play();
		expect(s.order.peek()).toEqual(["a", "b", "c"]);
		expect(s.item("c")?.position.peek().x).toBe(2);
		expect(s.item("a")?.position.peek().x).toBe(-2);
		clock.advance(0.5);
		expect(s.order.peek()).toEqual(["a", "b", "c"]);
		clock.advance(1);
		expect(s.order.peek()).toEqual(["b", "a", "c"]);
		clock.advance(0.5);
		expect(s.order.peek()).toEqual(["b", "c", "a"]);
	});
});
