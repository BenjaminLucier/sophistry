import { describe, expect, it } from "vitest";
import { packLayout, partitionLayout } from "./hierarchy.js";
import { hierarchyJoin, hierarchyKeys } from "./hierarchyJoin.js";

type Node = { name: string; size?: number; children?: Node[] };

const options = {
	value: (d: Node) => d.size ?? 0,
	label: (d: Node) => d.name,
	sort: false,
};

const before: Node = {
	name: "root",
	children: [
		{
			name: "a",
			children: [
				{ name: "a1", size: 4 },
				{ name: "a2", size: 2 },
			],
		},
		{ name: "b", size: 3 },
		{ name: "gone", size: 1 },
	],
};
const after: Node = {
	name: "renamed root",
	children: [
		{
			name: "a",
			children: [
				{ name: "a1", size: 1 },
				{ name: "a2", size: 2 },
				{ name: "a3", size: 3 },
			],
		},
		{ name: "b", size: 6 },
	],
};

const from = partitionLayout(before, options);
const to = partitionLayout(after, options);
const RECT = ["x0", "x1", "y0", "y1"] as const;
const join = (blend: number, staging?: "staged" | "together") =>
	hierarchyJoin(from, to, { blend, staging, fields: RECT });
const byLabel = (nodes: ReturnType<typeof join>, label: string) => {
	const found = nodes.find((n) => n.label === label);
	if (!found) throw new Error(label);
	return found;
};

describe("hierarchyKeys", () => {
	it("keys nodes by their path of names, the root by ''", () => {
		expect(hierarchyKeys(from)).toEqual([
			"",
			'/"a"',
			'/"a"/"a1"',
			'/"a"/"a2"',
			'/"b"',
			'/"gone"',
		]);
	});

	it("tells repeated sibling names apart by occurrence", () => {
		const twins = partitionLayout(
			{
				name: "r",
				children: [
					{ name: "x", size: 1 },
					{ name: "x", size: 2 },
				],
			},
			options,
		);
		expect(hierarchyKeys(twins)).toEqual(["", '/"x"', '/"x"#1']);
	});
});

describe("hierarchyJoin", () => {
	it("is the union tree in pre-order, parents first", () => {
		const nodes = join(0.5);
		expect(nodes.map((n) => n.label)).toEqual([
			"root",
			"a",
			"a1",
			"a2",
			"a3",
			"b",
			"gone",
		]);
		nodes.forEach((n, i) => {
			if (i === 0) expect(n.parent).toBe(-1);
			else expect(n.parent).toBeLessThan(i);
		});
		expect(nodes[byIndex(nodes, "a3")].parent).toBe(1);
	});

	it("is exactly `from` at 0 and exactly `to` at 1", () => {
		const start = join(0);
		for (const node of from) {
			const joined = byLabel(start, node.label);
			expect(joined.presence).toBe(1);
			for (const f of RECT) expect(joined[f]).toBe(node[f]);
		}
		expect(byLabel(start, "a3").presence).toBe(0);

		const end = join(1);
		for (const node of to) {
			// The root matches whatever its name; it takes the new one.
			const joined = byLabel(end, node.label);
			expect(joined.presence).toBe(1);
			expect(joined.value).toBe(node.value);
			for (const f of RECT) expect(joined[f]).toBeCloseTo(node[f], 12);
		}
		expect(byLabel(end, "gone").presence).toBe(0);
	});

	it("stages exit, then update, then enter", () => {
		// Exits and enters: three equal phases.
		const third = join(1 / 3);
		expect(byLabel(third, "gone").presence).toBe(0);
		expect(byLabel(third, "b").x0).toBe(byLabel(join(0), "b").x0);
		expect(byLabel(third, "a3").presence).toBe(0);
		const mid = join(0.5);
		const b0 = byLabel(join(0), "b");
		const b1 = byLabel(join(1), "b");
		expect(byLabel(mid, "b").x0).toBeCloseTo((b0.x0 + b1.x0) / 2, 12);
		expect(byLabel(mid, "b").value).toBeCloseTo(4.5, 12);
		expect(byLabel(mid, "a3").presence).toBe(0);
		const late = join(5 / 6);
		expect(byLabel(late, "b").x0).toBeCloseTo(b1.x0, 12);
		expect(byLabel(late, "a3").presence).toBeCloseTo(0.5, 12);
	});

	it("runs every stage over the whole blend, linearly, together", () => {
		const quarter = join(0.25, "together");
		expect(byLabel(quarter, "gone").presence).toBeCloseTo(0.75, 12);
		expect(byLabel(quarter, "a3").presence).toBeCloseTo(0.25, 12);
		expect(byLabel(quarter, "b").update).toBeCloseTo(0.25, 12);
	});

	it("records where each node came from", () => {
		const nodes = join(0.5);
		expect(byLabel(nodes, "gone").toAt).toBe(-1);
		expect(byLabel(nodes, "a3").fromAt).toBe(-1);
		const a = byLabel(nodes, "a");
		expect(from[a.fromAt].label).toBe("a");
		expect(to[a.toAt].label).toBe("a");
	});

	it("blends packed circles by their own fields", () => {
		const a = packLayout(before, { ...options, size: 2 });
		const b = packLayout(after, { ...options, size: 2 });
		const end = hierarchyJoin(a, b, { blend: 1, fields: ["x", "y", "r"] });
		const b1 = end.find((n) => n.label === "b");
		const want = b.find((n) => n.label === "b");
		expect(b1?.r).toBeCloseTo(want?.r ?? Number.NaN, 12);
		expect(b1?.x).toBeCloseTo(want?.x ?? Number.NaN, 12);
	});

	it("handles empty ends", () => {
		expect(hierarchyJoin([], [], { blend: 0.5, fields: RECT })).toEqual([]);
		const appear = hierarchyJoin([], to, { blend: 1, fields: RECT });
		expect(appear).toHaveLength(to.length);
		expect(appear.every((n) => n.presence === 1)).toBe(true);
	});
});

function byIndex(nodes: { label: string }[], label: string): number {
	return nodes.findIndex((n) => n.label === label);
}
