/**
 * `sankey` mounted: layout mapped
 * into scene units, the reveal as a pure function of `progress`, labels and
 * tooltips. Ribbons are path batch items, node bars rect items.
 */

import type { Point } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import { mount } from "../test-harness";
import { sankey } from "./sankey";
import type { Scene } from "./test-helpers";
import {
	batchHandlers,
	boxOfItem,
	itemsOf,
	labelOf,
	mountChart,
	texts,
} from "./test-helpers";

type Flow = { from: string; to: string; twh: number };

const flows: Flow[] = [
	{ from: "coal", to: "power", twh: 4 },
	{ from: "gas", to: "power", twh: 3 },
	{ from: "gas", to: "heat", twh: 2 },
	{ from: "power", to: "homes", twh: 3 },
	{ from: "power", to: "industry", twh: 4 },
	{ from: "heat", to: "homes", twh: 2 },
];

const props = (extra: Record<string, unknown> = {}) => ({
	data: flows,
	source: "from",
	target: "to",
	value: "twh",
	width: 6,
	height: 4,
	center: { x: 1, y: -0.5 },
	iterations: 0,
	...extra,
});
const show = (extra: Record<string, unknown> = {}) =>
	mount(sankey.create(props(extra)));
const nodesOf = (scene: Scene) => itemsOf(scene, "rect");
const flowsOf = (scene: Scene) => itemsOf(scene, "paths");

describe("sankey", () => {
	it("draws a node per id and a ribbon per flow, inside the box", () => {
		const scene = show();
		expect(nodesOf(scene)).toHaveLength(6);
		expect(flowsOf(scene)).toHaveLength(6);
		for (const item of [...nodesOf(scene), ...flowsOf(scene)]) {
			const b = boxOfItem(item);
			expect(b.minX).toBeGreaterThanOrEqual(1 - 3 - 1e-6);
			expect(b.maxX).toBeLessThanOrEqual(1 + 3 + 1e-6);
			expect(b.minY).toBeGreaterThanOrEqual(-0.5 - 2 - 1e-6);
			expect(b.maxY).toBeLessThanOrEqual(-0.5 + 2 + 1e-6);
		}
		expect(texts(scene)).toEqual(
			expect.arrayContaining([
				"coal",
				"power",
				"gas",
				"heat",
				"homes",
				"industry",
			]),
		);
	});

	it("conserves flow: node heights ∝ value, ribbons as thick as the node", () => {
		const scene = show();
		const heights = nodesOf(scene).map((item) => 2 * item.halfHeight);
		// coal, power, gas, heat, homes, industry
		const values = [4, 7, 5, 2, 5, 4];
		const ky = (heights[0] as number) / 4;
		heights.forEach((h, i) => {
			expect(h).toBeCloseTo((values[i] as number) * ky);
		});
		// Each ribbon's thickness at its source end is value × ky.
		flowsOf(scene).forEach((ribbon, i) => {
			const ring = ribbon.polylines[0] as Point[];
			expect((ring[0] as Point).y - (ring.at(-1) as Point).y).toBeCloseTo(
				(flows[i] as Flow).twh * ky,
			);
		});
	});

	it("puts the first node at the top of the chart (scene y up)", () => {
		const [coal, , gas] = nodesOf(show()).map(boxOfItem);
		expect(coal?.maxY).toBeCloseTo(1.5);
		expect(gas?.minY).toBeCloseTo(-2.5);
		expect(coal?.minX).toBeCloseTo(-2);
	});

	it("places columns left to right, sinks in the last", () => {
		const [coal, power, gas, heat, homes, industry] = nodesOf(show()).map(
			(item) => boxOfItem(item).minX,
		) as number[];
		expect(coal).toBeCloseTo(gas as number);
		expect(power).toBeCloseTo(heat as number);
		expect(homes).toBeCloseTo(industry as number);
		expect(coal).toBeLessThan(power as number);
		expect(power).toBeLessThan(homes as number);
	});

	it("labels the edge columns outside the diagram, an inner node right of its bar", () => {
		// The diagram spans x -2..4: no first- or last-column name over a band.
		const scene = show();
		expect(labelOf(scene, "coal").at.x).toBeLessThan(-2);
		expect(labelOf(scene, "homes").at.x).toBeGreaterThan(4);
		const [, power] = nodesOf(scene).map(boxOfItem);
		expect(labelOf(scene, "power").at.x).toBeGreaterThan(power?.maxX as number);
	});

	it("reveals nodes first, then flows left to right, as a function of progress", () => {
		// Nothing yet: nodes invisible, no flows.
		const zero = show({ progress: 0 });
		expect(flowsOf(zero)).toHaveLength(0);
		for (const item of nodesOf(zero)) expect(item.alpha).toBe(0);

		// Nodes done, flows not started.
		const nodesDone = show({ progress: 0.3 });
		expect(flowsOf(nodesDone)).toHaveLength(0);
		for (const item of nodesOf(nodesDone)) expect(item.alpha).toBe(1);

		// A quarter through the flows: only the first column's ribbons, half drawn.
		const quarter = flowsOf(show({ progress: 0.3 + 0.7 * 0.25 }));
		expect(quarter).toHaveLength(3);
		for (const r of quarter)
			expect(boxOfItem(r).maxX).toBeCloseTo(1 - 3 + 0.2 + 2.7 / 2);

		// Half through the flows: the first column's ribbons are complete.
		const half = flowsOf(show({ progress: 0.3 + 0.7 * 0.5 }));
		expect(half).toHaveLength(3);
		for (const r of half) expect(boxOfItem(r).maxX).toBeCloseTo(1 - 3 + 2.9);

		// Done: everything.
		expect(flowsOf(show({ progress: 1 }))).toHaveLength(6);
	});

	it("is deterministic", () => {
		const once = [...nodesOf(show({ iterations: 6 }))].map(boxOfItem);
		const twice = [...nodesOf(show({ iterations: 6 }))].map(boxOfItem);
		expect(once).toEqual(twice);
	});

	it("colours flows by source node; linkColor overrides", () => {
		const colors = [
			"#ff0000",
			"#00ff00",
			"#0000ff",
			"#ffff00",
			"#00ffff",
			"#ff00ff",
		];
		const fills = flowsOf(show({ colors })).map((item) => item.fill);
		// coal → power, gas → power, gas → heat, power → …, power → …, heat → homes
		expect(fills).toEqual([
			colors[0],
			colors[2],
			colors[2],
			colors[1],
			colors[1],
			colors[3],
		]);
		expect(flowsOf(show({ colors, linkColor: "target" }))[0]?.fill).toBe(
			colors[1],
		);
		expect(
			flowsOf(show({ linkColor: "#123456" })).every(
				(item) => item.fill === "#123456",
			),
		).toBe(true);
	});

	it("takes an explicit node list with ids and labels", () => {
		const nodes = [
			{ key: "gas", name: "Natural gas" },
			{ key: "coal", name: "Coal" },
			{ key: "power", name: "Power" },
			{ key: "heat", name: "Heat" },
			{ key: "homes", name: "Homes" },
			{ key: "industry", name: "Industry" },
		];
		const scene = mount(
			sankey.create({
				data: flows,
				source: "from",
				target: "to",
				value: "twh",
				nodes,
				nodeId: "key",
				nodeLabel: "name",
				width: 6,
				height: 4,
			}),
		);
		expect(texts(scene)).toEqual(
			expect.arrayContaining(["Natural gas", "Coal", "Industry"]),
		);
	});

	it("throws on a cycle", () => {
		expect(() =>
			mount(
				sankey.create({
					data: [
						{ from: "a", to: "b", twh: 1 },
						{ from: "b", to: "a", twh: 1 },
					],
					source: "from",
					target: "to",
					value: "twh",
					width: 6,
					height: 4,
				}),
			),
		).toThrow(/cycle/);
	});

	it("names flows and nodes for the tooltip", () => {
		const chart = sankey.create(props({ tooltip: true }));
		const t = mountChart(chart);
		const [ribbons, bars] = [0, 1].map((n) => {
			const nodes = chart.children;
			return nodes[n];
		});
		const ribbonNames = flowsOf(t.scene).map((_, i) =>
			(ribbons as unknown as { get(key: string): (i: number) => string }).get(
				"itemLabel",
			)(i),
		);
		expect(ribbonNames).toContain("coal → power: 4");
		const barHandlers = batchHandlers(bars as never);
		const barNames = nodesOf(t.scene).map((_, i) => barHandlers.itemLabel?.(i));
		expect(barNames).toEqual(expect.arrayContaining(["power: 7", "homes: 5"]));
		// Hovering a flow shows its tooltip.
		const at = ribbonNames.indexOf("gas → heat: 2");
		(ribbons as unknown as { get(key: string): (event: never) => void }).get(
			"onEnter",
		)({ item: at, pointerId: 1 } as never);
		expect(t.tip()).toBe("gas → heat: 2");

		const custom = sankey.create(
			props({ tooltip: (d: Flow) => `${d.twh} TWh` }),
		);
		const c = mountChart(custom);
		const first = custom.children[0] as unknown as {
			get(key: string): (i: number) => string;
		};
		expect(first.get("itemLabel")(0)).toBe("4 TWh");
		expect(batchHandlers(custom.children[1] as never).itemLabel?.(0)).toBe(
			"coal: 4",
		);
		void c;

		const none = sankey.create(props());
		mountChart(none);
		expect(batchHandlers(none)).toEqual({});
	});
});
