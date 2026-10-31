/**
 * `chord` mounted in a scene: groups and ribbons from flow records, the
 * ring's sweep and the ribbons' staggered fade as pure functions of
 * `progress`, labels, colours and tips. Ribbons and arcs are path batch items now.
 */

import { cssColor } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { mount } from "../test-harness";
import { chord } from "./chord";
import type { Scene } from "./test-helpers";
import { boxOf, items } from "./test-helpers";

type Move = { from: string; to: string; n: number };

const moves: Move[] = [
	{ from: "north", to: "south", n: 5 },
	{ from: "south", to: "north", n: 3 },
	{ from: "north", to: "west", n: 2 },
	{ from: "west", to: "south", n: 4 },
	{ from: "south", to: "west", n: 1 },
];

const diagram = (extra: Record<string, unknown> = {}) =>
	chord.create({
		data: moves,
		source: "from",
		target: "to",
		value: "n",
		radius: 2,
		center: { x: 1, y: -0.5 },
		padAngle: 0,
		...extra,
	});

/** Ribbons are translucent fills; arcs are opaque. */
const ribbonsOf = (scene: Scene) =>
	items(scene).filter((s) => s.fillOpacity < 1);
const arcsOf = (scene: Scene) =>
	items(scene).filter((s) => s.fillOpacity === 1);
const texts = (scene: Scene) => scene.texts().map((s) => s.text);
const get = (node: unknown, key: string) =>
	(node as { get(key: string): unknown }).get(key);

describe("chord", () => {
	it("draws an arc per group and a ribbon per connected pair, inside the circle", () => {
		const scene = mount(diagram());
		expect(arcsOf(scene)).toHaveLength(3);
		// north–south, north–west, south–west.
		expect(ribbonsOf(scene)).toHaveLength(3);
		// One path batch each.
		expect(scene.marks()).toHaveLength(2);
		for (const s of items(scene)) {
			const b = boxOf(s.polylines);
			expect(b.minX).toBeGreaterThanOrEqual(1 - 2 - 1e-4);
			expect(b.maxX).toBeLessThanOrEqual(1 + 2 + 1e-4);
			expect(b.minY).toBeGreaterThanOrEqual(-0.5 - 2 - 1e-4);
			expect(b.maxY).toBeLessThanOrEqual(-0.5 + 2 + 1e-4);
		}
		expect(texts(scene)).toEqual(
			expect.arrayContaining(["north", "south", "west"]),
		);
	});

	it("colours groups in first-seen order and ribbons by their larger end", () => {
		const scene = mount(diagram({ colors: ["#ff0000", "#00ff00", "#0000ff"] }));
		const [red, green, blue] = ["#ff0000", "#00ff00", "#0000ff"].map((c) =>
			cssColor(c),
		);
		expect(arcsOf(scene).map((s) => s.fill)).toEqual([red, green, blue]);
		// north→south 5 beats 3: red; north→west 2 vs 0: red; west→south 4 beats 1: blue.
		expect(ribbonsOf(scene).map((s) => s.fill)).toEqual([red, red, blue]);
	});

	it("directed: one ribbon per flow, and sinks get an arc", () => {
		const sinks = [
			{ from: "a", to: "b", n: 3 },
			{ from: "a", to: "c", n: 1 },
		];
		const plain = mount(
			chord.create({ data: sinks, source: "from", target: "to", value: "n" }),
		);
		expect(arcsOf(plain)).toHaveLength(1);
		const directed = mount(
			chord.create({
				data: sinks,
				source: "from",
				target: "to",
				value: "n",
				directed: true,
			}),
		);
		expect(arcsOf(directed)).toHaveLength(3);
		expect(ribbonsOf(directed)).toHaveLength(2);
	});

	it("arrows: directed ribbons end in a head on the receiving group", () => {
		const sinks = [
			{ from: "a", to: "b", n: 3 },
			{ from: "a", to: "c", n: 1 },
		];
		const props = {
			data: sinks,
			source: "from",
			target: "to",
			value: "n",
			radius: 2,
			directed: true,
		} as const;
		const plain = ribbonsOf(mount(chord.create(props)));
		const arrowed = ribbonsOf(mount(chord.create({ ...props, arrows: true })));
		expect(arrowed).toHaveLength(2);
		for (let i = 0; i < 2; i++) {
			const ring = arrowed[i]?.polylines[0] ?? [];
			const reference = plain[i]?.polylines[0] ?? [];
			expect(ring.length).toBeLessThan(reference.length);
			const radii = ring.map((p) => Math.hypot(p.x, p.y));
			const reach = Math.max(...reference.map((p) => Math.hypot(p.x, p.y)));
			expect(Math.max(...radii)).toBeCloseTo(reach, 6);
			expect(
				radii.filter((r) => Math.abs(r - (reach - 0.16)) < 1e-6),
			).toHaveLength(2);
		}
		// Undirected chords carry both directions: no heads.
		const round = (lines: { x: number; y: number }[][]) =>
			lines.map((line) =>
				line.map((p) => [Math.round(p.x * 1e9), Math.round(p.y * 1e9)]),
			);
		expect(
			ribbonsOf(mount(diagram({ arrows: true }))).map((s) =>
				round(s.polylines),
			),
		).toEqual(ribbonsOf(mount(diagram())).map((s) => round(s.polylines)));
	});

	it("sweeps the ring first, then fades the ribbons in", () => {
		expect(items(mount(diagram({ progress: 0 })))).toHaveLength(0);

		// A quarter of the ring: north's arc (7 of 15 → 47% of the turn) is
		// partly drawn, the others not yet; no ribbons.
		const quarter = mount(diagram({ progress: 0.125 }));
		expect(ribbonsOf(quarter)).toHaveLength(0);
		expect(arcsOf(quarter)).toHaveLength(1);

		const ring = mount(diagram({ progress: 0.5 }));
		expect(arcsOf(ring)).toHaveLength(3);
		expect(ribbonsOf(ring)).toHaveLength(0);

		const fading = ribbonsOf(mount(diagram({ progress: 0.75 }))).map(
			(s) => s.opacity,
		);
		expect(fading.length).toBeGreaterThan(0);
		expect(Math.min(...fading)).toBeLessThan(1);

		const all = ribbonsOf(mount(diagram({ progress: 1 })));
		expect(all.every((s) => s.opacity === 1)).toBe(true);
	});

	it("scrubs progress back to the same frame", () => {
		const node = diagram({ progress: 0 });
		const scene = mount(node);
		const at = (p: number) => {
			node.set("progress", p);
			scene.commit();
			return items(scene).map((s) => [s.fill, s.opacity, s.polylines]);
		};
		const mid = at(0.7);
		at(1);
		at(0.2);
		expect(at(0.7)).toEqual(mid);
	});

	it("throws on a flow naming a group missing from nodes", () => {
		expect(() =>
			mount(
				chord.create({
					data: moves,
					source: "from",
					target: "to",
					value: "n",
					nodes: ["north", "south"],
				}),
			),
		).toThrow(/west/);
	});

	it("takes node records with ids and labels", () => {
		const scene = mount(
			chord.create({
				data: moves,
				source: "from",
				target: "to",
				value: "n",
				nodes: [
					{ id: "west", name: "W" },
					{ id: "north", name: "N" },
					{ id: "south", name: "S" },
				],
				nodeId: "id",
				nodeLabel: "name",
			}),
		);
		expect(texts(scene)).toEqual(["W", "N", "S"]);
	});

	it("names chords and groups for their tips", () => {
		const node = diagram({ tooltip: true });
		mount(node);
		const [ribbons, arcs] = node.children;
		const ribbonLabel = get(ribbons, "itemLabel") as (i: number) => string;
		const arcLabel = get(arcs, "itemLabel") as (i: number) => string;
		expect([0, 1, 2].map(ribbonLabel)).toEqual(
			expect.arrayContaining([
				"north → south: 5 · south → north: 3",
				"north → west: 2",
			]),
		);
		expect([0, 1, 2].map(arcLabel)).toContain("north: 7");

		const custom = diagram({ tooltip: (d: Move) => `${d.n} people` });
		mount(custom);
		const [customRibbons, customArcs] = custom.children;
		expect(
			[0, 1, 2].map(get(customRibbons, "itemLabel") as (i: number) => string),
		).toContain("5 people");
		expect(
			[0, 1, 2].map(get(customArcs, "itemLabel") as (i: number) => string),
		).toContain("west: 4");
		// Without `tooltip`, no interaction at all.
		const quiet = diagram();
		mount(quiet);
		expect(get(quiet.children[0], "itemLabel")).toBeUndefined();
	});

	it("shows a chord's tip on hover", () => {
		const node = diagram({ tooltip: true });
		const scene = mount(node);
		const [ribbons] = node.children;
		const ribbonLabel = get(ribbons, "itemLabel") as (i: number) => string;
		const item = [0, 1, 2].find((i) => ribbonLabel(i) === "north → west: 2");
		expect(item).toBeDefined();
		expect(texts(scene)).not.toContain("north → west: 2");
		const onEnter = get(ribbons, "onEnter") as (event: unknown) => void;
		onEnter({ pointerId: -1, item });
		scene.commit();
		expect(texts(scene)).toContain("north → west: 2");
		(get(ribbons, "onLeave") as (event: unknown) => void)({ item });
		scene.commit();
		expect(texts(scene)).not.toContain("north → west: 2");
	});
});
