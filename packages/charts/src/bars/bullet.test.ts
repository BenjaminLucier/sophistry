/**
 * `bullet`: band, bar and target geometry in scene units, per-row and shared
 * scales, negative values, the frame-before-data reveal, titles, ticks,
 * tips, and no console diagnostics while it animates.
 */

import type { SceneNode } from "@sophistry/core";
import { cssColor } from "@sophistry/core/internal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "../test-harness.js";
import type { BulletProps } from "./bullet.js";
import { bullet as bulletDefinition, bulletTooltip } from "./bullet.js";
import type { DrawnBox } from "./test-helpers.js";
import { boxes } from "./test-helpers.js";

const POOR = cssColor("#444444");
const OK = cssColor("#888888");
const GOOD = cssColor("#cccccc");
const BAR = cssColor("#0000ff");
const TARGET = cssColor("#ff0000");

type Scene = ReturnType<typeof mount>;

/** The rect items filled with `color`, with area. */
const filledWith = (scene: Scene, color: string): DrawnBox[] =>
	boxes(scene.marks()).filter(
		(b) => b.fill === color && b.maxX - b.minX > 0 && b.maxY - b.minY > 0,
	);
const texts = (scene: Scene) => scene.texts().map((t) => t.text);

type Kpi = {
	name: string;
	actual: number;
	goal?: number;
	bands?: number[];
	top?: number;
};

const revenue: Kpi = {
	name: "Revenue",
	actual: 270,
	goal: 250,
	bands: [150, 225, 300],
};

/**
 * One 10 × 2 row at the origin with no titles or ticks: the scale runs from
 * x = −5 to 5 and the band is 2 × (1 − 0.35) = 1.3 thick.
 */
const create = (props: Partial<BulletProps<Kpi>> = {}) =>
	bulletDefinition.create({
		data: [revenue],
		value: "actual",
		target: "goal",
		ranges: "bands",
		width: 10,
		height: 2,
		ticks: false,
		rangeColors: [POOR, OK, GOOD],
		color: BAR,
		targetColor: TARGET,
		...props,
	} as BulletProps<unknown>);
const bullet = (props: Partial<BulletProps<Kpi>> = {}) => mount(create(props));

describe("bullet", () => {
	it("draws the bands, the bar from zero and the target in scene units", () => {
		const scene = bullet();
		const [poor] = filledWith(scene, POOR);
		const [ok] = filledWith(scene, OK);
		const [good] = filledWith(scene, GOOD);
		// 0..150 / 150..225 / 225..300 of a 0..300 scale over x = −5..5.
		expect(poor?.minX).toBeCloseTo(-5);
		expect(poor?.maxX).toBeCloseTo(0);
		expect(ok?.maxX).toBeCloseTo(2.5);
		expect(good?.maxX).toBeCloseTo(5);
		expect((good?.maxY ?? 0) - (good?.minY ?? 0)).toBeCloseTo(1.3);

		const [bar] = filledWith(scene, BAR);
		expect(bar?.minX).toBeCloseTo(-5);
		expect(bar?.maxX).toBeCloseTo(4); // 270 / 300
		expect((bar?.maxY ?? 0) - (bar?.minY ?? 0)).toBeCloseTo(1.3 / 3);

		const [target] = filledWith(scene, TARGET);
		const box = target as DrawnBox;
		expect((box.minX + box.maxX) / 2).toBeCloseTo(-5 + (250 / 300) * 10);
		expect(box.maxY - box.minY).toBeCloseTo(1.3 * 0.7);
		// Bands under the bar under the target.
		expect(box.zIndex).toBeGreaterThan(bar?.zIndex ?? 0);
		expect(bar?.zIndex).toBeGreaterThan(good?.zIndex ?? 0);
	});

	it("defaults the bands to graded theme greys, worst darkest", () => {
		const scene = mount(
			bulletDefinition.create({
				data: [5],
				ranges: () => [2, 4, 6],
				width: 6,
				height: 1,
			}),
		);
		// Three bands and a bar.
		const all = boxes(scene.marks());
		expect(all).toHaveLength(4);
		expect(new Set(all.slice(0, 3).map((b) => b.fill)).size).toBe(3);
	});

	it("gives each row its own scale unless sharedScale", () => {
		const data: Kpi[] = [
			{ name: "A", actual: 50, bands: [100] },
			{ name: "B", actual: 5, bands: [10] },
		];
		const widths = (sharedScale: boolean) =>
			filledWith(bullet({ data, sharedScale, target: undefined }), BAR).map(
				(b) => b.maxX - b.minX,
			);
		const own = widths(false);
		expect(own[0]).toBeCloseTo(5);
		expect(own[1]).toBeCloseTo(5);
		const shared = widths(true);
		expect(shared[0]).toBeCloseTo(5);
		expect(shared[1]).toBeCloseTo(0.5);
	});

	it("stacks rows top-down", () => {
		const scene = bullet({ data: [revenue, { ...revenue, name: "Profit" }] });
		const [first, second] = filledWith(scene, BAR) as [DrawnBox, DrawnBox];
		expect(first.minY).toBeGreaterThan(second.maxY);
		// Each in its own half of the 2-unit height.
		expect((first.minY + first.maxY) / 2).toBeCloseTo(0.5);
		expect((second.minY + second.maxY) / 2).toBeCloseTo(-0.5);
	});

	it("honours min and max as numbers or channels", () => {
		const scene = bullet({ min: 100, max: (d: Kpi) => d.top ?? 400 });
		const [bar] = filledWith(scene, BAR);
		// 100..400: the bar starts at the scale's start (no zero) and ends at 270.
		expect(bar?.minX).toBeCloseTo(-5);
		expect(bar?.maxX).toBeCloseTo(-5 + (170 / 300) * 10);
		const [poor] = filledWith(scene, POOR);
		expect(poor?.maxX).toBeCloseTo(-5 + (50 / 300) * 10);
	});

	it("draws a negative value leftward from zero", () => {
		const scene = bullet({
			data: [{ name: "Margin", actual: -15, goal: 10, bands: [0, 20] }],
			rangeColors: [POOR, GOOD],
		});
		// Scale −20..20: zero at x = 0, −15 at x = −3.75.
		const [bar] = filledWith(scene, BAR);
		expect(bar?.minX).toBeCloseTo(-3.75);
		expect(bar?.maxX).toBeCloseTo(0);
		const [target] = filledWith(scene, TARGET) as [DrawnBox];
		expect((target.minX + target.maxX) / 2).toBeCloseTo(2.5);
	});

	it("writes titles right-aligned left of the scale, and tick numbers", () => {
		const scene = bullet({ label: "name", ticks: true });
		const title = scene.texts().find((s) => s.text === "Revenue");
		expect(title?.style.align).toBe("right");
		const [poor] = filledWith(scene, POOR) as [DrawnBox];
		expect(title?.at.x).toBeLessThan(poor.minX);
		expect(title?.at.x).toBeGreaterThan(-5);
		expect(texts(scene)).toEqual(
			expect.arrayContaining(["0", "100", "200", "300"]),
		);
		const zero = scene.texts().find((s) => s.text === "0");
		expect(zero?.at.x).toBeCloseTo(poor.minX);
		expect(zero?.at.y).toBeLessThan(poor.minY);
		expect(zero?.style.fontSize).toBeCloseTo(0.16);
	});

	it("omits tick numbers with ticks: false", () => {
		expect(texts(bullet({ label: "name" }))).toEqual(["Revenue"]);
	});

	it("skips non-finite values and targets without throwing", () => {
		const scene = bullet({
			data: [{ name: "Empty", actual: Number.NaN, goal: Number.NaN }],
			ranges: undefined,
		});
		expect(filledWith(scene, BAR)).toHaveLength(0);
		expect(filledWith(scene, TARGET)).toHaveLength(0);
	});

	it("reveals frame, then bars from zero, then targets, scrubbing back", () => {
		const node = create({
			label: "name",
			labelWidth: 0,
			progress: 0,
		});
		const scene = mount(node);
		const set = (progress: number) => {
			node.set("progress", progress);
			scene.commit();
		};
		expect(boxes(scene.marks())).toHaveLength(0);
		expect(scene.texts()).toHaveLength(0);

		// Frame phase: bands and title half faded in, no data yet.
		set(0.15);
		expect(filledWith(scene, POOR)[0]?.opacity).toBeCloseTo(0.5);
		expect(scene.texts()[0]?.style.opacity).toBeCloseTo(0.5);
		expect(filledWith(scene, BAR)).toHaveLength(0);
		expect(filledWith(scene, TARGET)).toHaveLength(0);

		// Data phase, 40% in: the bar half grown (linear), no target yet.
		set(0.3 + 0.4 * 0.7);
		expect(filledWith(scene, POOR)[0]?.opacity).toBeCloseTo(1);
		const [bar] = filledWith(scene, BAR);
		expect(bar?.maxX).toBeCloseTo(-5 + 9 * 0.5);
		expect(bar?.opacity).toBeCloseTo(1);
		expect(filledWith(scene, TARGET)).toHaveLength(0);

		// 90% in: the bar is full and the target half drawn.
		set(0.3 + 0.9 * 0.7);
		expect(filledWith(scene, BAR)[0]?.maxX).toBeCloseTo(4);
		const [target] = filledWith(scene, TARGET) as [DrawnBox];
		expect(target.maxY - target.minY).toBeCloseTo(1.3 * 0.35);
		expect(target.opacity).toBeCloseTo(0.5);

		set(1);
		expect(filledWith(scene, TARGET)[0]?.opacity).toBeCloseTo(1);

		// Scrubbing back undoes it.
		set(0.15);
		expect(filledWith(scene, BAR)).toHaveLength(0);
		expect(filledWith(scene, TARGET)).toHaveLength(0);
	});

	it("fades the bar in at full length when the scale has no zero", () => {
		const scene = bullet({ min: 100, progress: 0.3 + 0.4 * 0.7 });
		const [bar] = filledWith(scene, BAR);
		expect(bar?.maxX).toBeCloseTo(-5 + (170 / 200) * 10);
		expect(bar?.opacity).toBeCloseTo(0.5);
	});

	it("staggers rows top-down", () => {
		const scene = bullet({
			data: [revenue, revenue, revenue],
			height: 3,
			progress: 0.3 + 0.5 * 0.7,
		});
		const lengths = filledWith(scene, BAR).map((b) => b.maxX - b.minX);
		expect(lengths).toHaveLength(3);
		expect(lengths[0]).toBeGreaterThan(lengths[1] as number);
		expect(lengths[1]).toBeGreaterThan(lengths[2] as number);
	});

	it("tips the bar with its label, value and target", () => {
		const node = bulletDefinition.create({
			data: [revenue, { name: "Orders", actual: 320, bands: [400] }],
			value: "actual",
			target: "goal",
			ranges: "bands",
			label: "name",
			width: 10,
			height: 2,
			tooltip: true,
		});
		mount(node);
		// The bars are the second batched node; each item reads out its tip.
		const bars = (node as unknown as { children: SceneNode[] })
			.children[1] as SceneNode<{
			shared: {
				itemLabel?: (item: number) => string | undefined;
				onEnter?: (event: unknown) => void;
			};
		}>;
		const shared = bars.get("shared");
		expect([shared.itemLabel?.(0), shared.itemLabel?.(1)]).toEqual([
			"Revenue: 270 (target 250)",
			"Orders: 320",
		]);
		shared.onEnter?.({ item: 0, pointerId: -1 });
		expect(bulletTooltip(node)?.active.peek()?.text).toBe(
			"Revenue: 270 (target 250)",
		);
	});

	it("takes number[] data with no channels", () => {
		const scene = mount(
			bulletDefinition.create({
				data: [3, 7],
				width: 6,
				height: 2,
				color: BAR,
			}),
		);
		expect(filledWith(scene, BAR)).toHaveLength(2);
	});
});

describe("console diagnostics", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("mounts and animates a reveal with tips on, with no warnings", () => {
		const messages: string[] = [];
		for (const level of ["warn", "error"] as const)
			vi.spyOn(console, level).mockImplementation((...args) => {
				messages.push(`${level}: ${args.map(String).join(" ")}`);
			});
		const node = bulletDefinition.create({
			data: [revenue, { name: "Margin", actual: -4, goal: 3, bands: [0, 5] }],
			value: "actual",
			target: "goal",
			ranges: "bands",
			label: "name",
			width: 10,
			height: 3,
			progress: 0,
			tooltip: true,
		});
		const scene = mount(node);
		for (let step = 1; step <= 10; step++) {
			node.set("progress", step / 10);
			scene.commit();
		}
		expect(messages).toEqual([]);
	});
});
