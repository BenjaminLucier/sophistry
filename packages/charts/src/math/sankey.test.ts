import { describe, expect, it } from "vitest";
import type { SankeyLinkInput } from "./sankey.js";
import { sankeyLayout, sankeyRibbon } from "./sankey.js";

const energy: SankeyLinkInput[] = [
	{ source: "coal", target: "power", value: 4 },
	{ source: "gas", target: "power", value: 3 },
	{ source: "gas", target: "heat", value: 2 },
	{ source: "power", target: "homes", value: 3 },
	{ source: "power", target: "industry", value: 4 },
	{ source: "heat", target: "homes", value: 2 },
];

const box = { width: 6, height: 4, nodeWidth: 0.2, nodePadding: 0.2 };

describe("sankeyLayout", () => {
	it("infers nodes in first-seen order with value = max(in, out)", () => {
		const { nodes } = sankeyLayout(energy, box);
		expect(nodes.map((n) => n.id)).toEqual([
			"coal",
			"power",
			"gas",
			"heat",
			"homes",
			"industry",
		]);
		expect(nodes.map((n) => n.value)).toEqual([4, 7, 5, 2, 5, 4]);
		expect(nodes.map((n) => n.index)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it("uses max(in, out) when a node is unbalanced", () => {
		const { nodes } = sankeyLayout([
			{ source: "a", target: "b", value: 5 },
			{ source: "b", target: "c", value: 2 },
		]);
		expect(nodes[1].value).toBe(5);
	});

	it("assigns columns by longest path, sinks justified to the last", () => {
		const links: SankeyLinkInput[] = [
			{ source: "a", target: "b", value: 1 },
			{ source: "b", target: "c", value: 1 },
			{ source: "a", target: "c", value: 1 },
			{ source: "a", target: "d", value: 1 },
		];
		const depth = (align?: "justify" | "left" | "right" | "center") =>
			Object.fromEntries(
				sankeyLayout(links, { align }).nodes.map((n) => [n.id, n.depth]),
			);
		expect(depth()).toEqual({ a: 0, b: 1, c: 2, d: 2 });
		expect(depth("left")).toEqual({ a: 0, b: 1, c: 2, d: 1 });
		expect(depth("right")).toEqual({ a: 0, b: 1, c: 2, d: 2 });
		expect(sankeyLayout(links).columns).toBe(3);

		// A late source: left keeps it at 0, right and center pull it forward.
		const late: SankeyLinkInput[] = [
			{ source: "a", target: "b", value: 1 },
			{ source: "b", target: "c", value: 1 },
			{ source: "x", target: "c", value: 1 },
		];
		const lateDepth = (align: "left" | "right" | "center") =>
			sankeyLayout(late, { align }).nodes.find((n) => n.id === "x")?.depth;
		expect(lateDepth("left")).toBe(0);
		expect(lateDepth("right")).toBe(1);
		expect(lateDepth("center")).toBe(1);
	});

	it("places columns evenly across the width", () => {
		const { nodes } = sankeyLayout(energy, box);
		const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
		expect(byId.coal.x0).toBeCloseTo(0);
		expect(byId.power.x0).toBeCloseTo(2.9);
		expect(byId.homes.x1).toBeCloseTo(6);
		for (const n of nodes) expect(n.x1 - n.x0).toBeCloseTo(0.2);
	});

	it("conserves flow: node heights ∝ value, link widths sum to each side", () => {
		const { nodes, links, ky } = sankeyLayout(energy, box);
		expect(ky).toBeGreaterThan(0);
		for (const node of nodes) {
			expect(node.y1 - node.y0).toBeCloseTo(node.value * ky);
			const out = links.filter((l) => l.source === node.index);
			const into = links.filter((l) => l.target === node.index);
			const sum = (ls: typeof links) => ls.reduce((s, l) => s + l.width, 0);
			if (out.length > 0) expect(sum(out)).toBeCloseTo(node.y1 - node.y0);
			if (into.length > 0) expect(sum(into)).toBeCloseTo(node.y1 - node.y0);
		}
		for (const link of links) expect(link.width).toBeCloseTo(link.value * ky);
	});

	it("keeps nodes inside the box, without overlaps, padding apart", () => {
		const { nodes } = sankeyLayout(energy, box);
		for (const n of nodes) {
			expect(n.y0).toBeGreaterThanOrEqual(-1e-6);
			expect(n.y1).toBeLessThanOrEqual(4 + 1e-6);
		}
		const columns = new Map<number, typeof nodes>();
		for (const n of nodes)
			columns.set(n.depth, [...(columns.get(n.depth) ?? []), n]);
		for (const column of columns.values()) {
			const sorted = [...column].sort((a, b) => a.y0 - b.y0);
			for (let i = 1; i < sorted.length; i++) {
				expect(sorted[i].y0 - sorted[i - 1].y1).toBeGreaterThanOrEqual(
					0.2 - 1e-6,
				);
			}
		}
	});

	it("scales so the fullest column fills the height", () => {
		const { nodes, ky } = sankeyLayout(energy, { ...box, iterations: 0 });
		// Columns hold 9, 9 and 9 units; each has two nodes, so one gap.
		expect(ky).toBeCloseTo((4 - 0.2) / 9);
		// Without relaxation, nodes stack in node order: coal above gas.
		const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
		expect(byId.coal.y0).toBeLessThan(byId.gas.y0);
		expect(byId.coal.y0).toBeCloseTo(0);
		expect(byId.gas.y1).toBeCloseTo(4);
	});

	it("attaches links so ribbons do not cross at a node", () => {
		const { nodes, links } = sankeyLayout(energy, box);
		const gas = nodes.find((n) => n.id === "gas");
		const out = links
			.filter((l) => l.source === gas?.index)
			.sort((a, b) => a.y0 - b.y0);
		const targetsTop = out.map((l) => nodes[l.target].y0);
		expect(targetsTop).toEqual([...targetsTop].sort((a, b) => a - b));
		// The first link starts flush with the node's top.
		expect(out[0].y0 - out[0].width / 2).toBeCloseTo(gas?.y0 ?? Number.NaN);
	});

	it("is deterministic", () => {
		expect(sankeyLayout(energy, box)).toEqual(sankeyLayout(energy, box));
	});

	it("follows an explicit node order", () => {
		const { nodes } = sankeyLayout(energy, {
			...box,
			nodes: ["gas", "coal", "heat", "power", "industry", "homes"],
		});
		expect(nodes.map((n) => n.id)).toEqual([
			"gas",
			"coal",
			"heat",
			"power",
			"industry",
			"homes",
		]);
	});

	it("throws on a link to a node missing from the node list", () => {
		expect(() => sankeyLayout(energy, { nodes: ["coal"] })).toThrow(/not in/);
	});

	it("throws on a cycle, including a self-loop", () => {
		expect(() =>
			sankeyLayout([
				{ source: "a", target: "b", value: 1 },
				{ source: "b", target: "c", value: 1 },
				{ source: "c", target: "a", value: 1 },
			]),
		).toThrow(/cycle/);
		expect(() =>
			sankeyLayout([{ source: "a", target: "a", value: 1 }]),
		).toThrow(/cycle/);
	});

	it("degrades on data problems", () => {
		expect(sankeyLayout([])).toEqual({
			nodes: [],
			links: [],
			columns: 0,
			ky: 0,
		});
		const { links, nodes } = sankeyLayout([
			{ source: "a", target: "b", value: Number.NaN },
			{ source: "a", target: "c", value: -3 },
			{ source: "a", target: "d", value: 2 },
		]);
		expect(links.map((l) => l.value)).toEqual([0, 0, 2]);
		expect(links.map((l) => l.width > 0)).toEqual([false, false, true]);
		for (const n of nodes) expect(Number.isFinite(n.y0)).toBe(true);
		// All-zero flows: nothing has height, nothing is NaN.
		const zero = sankeyLayout([{ source: "a", target: "b", value: 0 }]);
		expect(zero.ky).toBe(0);
		expect(zero.nodes.every((n) => n.y1 === n.y0)).toBe(true);
	});

	it("numeric ids work", () => {
		const { nodes } = sankeyLayout([
			{ source: 1, target: 2, value: 1 },
			{ source: 2, target: 3, value: 1 },
		]);
		expect(nodes.map((n) => [n.id, n.depth])).toEqual([
			[1, 0],
			[2, 1],
			[3, 2],
		]);
	});
});

describe("sankeyRibbon", () => {
	it("is a closed band between the two ends, horizontal at both", () => {
		const ring = sankeyRibbon(0, 1, 4, 3, 0.5, { samples: 9 });
		expect(ring).toHaveLength(18);
		expect(ring[0]).toEqual({ x: 0, y: 0.75 });
		expect(ring[8].x).toBeCloseTo(4);
		expect(ring[8].y).toBeCloseTo(2.75);
		expect(ring[9].x).toBeCloseTo(4);
		expect(ring[9].y).toBeCloseTo(3.25);
		expect(ring[17]).toEqual({ x: 0, y: 1.25 });
		// Horizontal tangents: the first steps barely move in y.
		expect(Math.abs(ring[1].y - ring[0].y)).toBeLessThan(
			Math.abs(ring[1].x - ring[0].x),
		);
		// Midpoint of the parameter is midway across and midway down.
		expect(ring[4].x).toBeCloseTo(2);
		expect(ring[4].y).toBeCloseTo(1.75);
		// Constant thickness in y at every sample.
		for (let k = 0; k < 9; k++) {
			expect(ring[17 - k].y - ring[k].y).toBeCloseTo(0.5);
			expect(ring[17 - k].x).toBeCloseTo(ring[k].x);
		}
	});

	it("partial(t) keeps the first t of the parameter, cut vertically", () => {
		const full = sankeyRibbon(0, 1, 4, 3, 0.5, { samples: 9 });
		const half = sankeyRibbon(0, 1, 4, 3, 0.5, { samples: 9, t: 0.5 });
		expect(half).toHaveLength(18);
		expect(half[0]).toEqual(full[0]);
		expect(half[8].x).toBeCloseTo(full[4].x);
		expect(half[8].y).toBeCloseTo(full[4].y);
		expect(half[9].x).toBeCloseTo(half[8].x);
		expect(Math.max(...half.map((p) => p.x))).toBeCloseTo(2);
		expect(sankeyRibbon(0, 1, 4, 3, 0.5, { t: 0 })).toEqual([]);
	});
});
