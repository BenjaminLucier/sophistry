import type { LayoutStyle } from "../../src/index.ts";
import type { Fixture } from "../fixture.ts";
import { node, repeat, words } from "../fixture.ts";

const text = (
	count: number,
	style: LayoutStyle = {},
	width = 20,
	height = 10,
) => words(repeat(count, width, height), style);
const box = (width: number, height: number, style: LayoutStyle = {}) =>
	node({ width, height, ...style });

export const fixtures: Fixture[] = [
	{
		name: "shrink-to-fit root takes its content",
		root: node(
			{ display: "grid", gridTemplateColumns: ["auto", "auto"], columnGap: 10 },
			text(3),
			text(2),
		),
	},
	{
		name: "shrink-to-fit root wraps at the available width",
		available: { width: 100, height: 1000 },
		root: node(
			{ display: "grid", gridTemplateColumns: ["auto", "auto"] },
			text(6),
			text(6),
		),
	},
	{
		name: "root under max width",
		root: node(
			{ display: "grid", maxWidth: 90, gridTemplateColumns: ["auto", "auto"] },
			text(6),
			text(6),
		),
	},
	{
		name: "root with a min width stretches its auto columns",
		root: node(
			{ display: "grid", minWidth: 300, gridTemplateColumns: ["auto", "auto"] },
			text(2),
			text(4),
		),
	},
	{
		name: "fraction columns of a shrink-to-fit root",
		root: node(
			{ display: "grid", gridTemplateColumns: [{ fr: 1 }, { fr: 2 }] },
			text(3),
			text(3),
		),
	},
	{
		name: "text rows take the tallest cell",
		root: node(
			{ display: "grid", width: 120, gridTemplateColumns: [60, 60] },
			text(6),
			text(2),
			text(1),
			text(8),
		),
	},
	{
		name: "spanning item grows auto tracks",
		root: node(
			{ display: "grid", gridTemplateColumns: ["auto", "auto"] },
			box(100, 10, { gridColumn: { span: 2 } }),
			box(30, 10),
			box(30, 10),
		),
	},
	{
		name: "spanning item grows tracks beyond a fixed one",
		root: node(
			{ display: "grid", gridTemplateColumns: [40, "auto", "auto"] },
			box(200, 10, { gridColumn: { span: 3 } }),
		),
	},
	{
		name: "spanning item shares extra space over the gap",
		root: node(
			{
				display: "grid",
				gridTemplateColumns: ["auto", "auto"],
				columnGap: 20,
			},
			box(100, 10, { gridColumn: { span: 2 } }),
		),
	},
	{
		name: "spanning item with a wider track already",
		root: node(
			{ display: "grid", gridTemplateColumns: ["auto", "auto"] },
			box(50, 10),
			box(80, 10),
			box(100, 10, { gridColumn: { span: 2 } }),
		),
	},
	{
		name: "spanning item does not grow fraction tracks",
		root: node(
			{
				display: "grid",
				width: 100,
				gridTemplateColumns: [{ fr: 1 }, { fr: 1 }],
			},
			box(300, 10, { gridColumn: { span: 2 } }),
		),
	},
	{
		name: "spanning item grows an auto track next to a fraction",
		root: node(
			{ display: "grid", width: 300, gridTemplateColumns: ["auto", { fr: 1 }] },
			box(120, 10, { gridColumn: { span: 2 } }),
			box(20, 10),
		),
	},
	{
		name: "spanning rows share a tall item",
		root: node(
			{ display: "grid", width: 100, gridTemplateColumns: [50, 50], rowGap: 4 },
			box(40, 100, { gridRow: { span: 2 } }),
			box(40, 10),
			box(40, 10),
		),
	},
	{
		name: "max-content item sets an auto column",
		root: node(
			{ display: "grid", gridTemplateColumns: ["auto", 50] },
			text(5),
			node({}),
		),
	},
	{
		name: "auto column shrinks text to fit a fixed container",
		root: node(
			{ display: "grid", width: 100, gridTemplateColumns: ["auto", "auto"] },
			text(6),
			text(2),
		),
	},
	{
		name: "min-content column wraps text",
		root: node(
			{
				display: "grid",
				width: 200,
				gridTemplateColumns: ["min-content", { fr: 1 }],
			},
			text(6),
			text(2),
		),
	},
	{
		name: "max-content rows size to wrapped text",
		root: node(
			{
				display: "grid",
				width: 60,
				gridTemplateColumns: [60],
				gridTemplateRows: ["max-content", "min-content"],
			},
			text(6),
			text(6),
		),
	},
	{
		name: "overflow hidden item does not stretch fraction tracks",
		root: node(
			{
				display: "grid",
				width: 100,
				gridTemplateColumns: [{ fr: 1 }, { fr: 1 }],
			},
			box(80, 10, { overflow: "hidden" }),
			box(10, 10),
		),
	},
	{
		name: "overflow hidden text does not stretch fraction tracks",
		root: node(
			{
				display: "grid",
				width: 100,
				gridTemplateColumns: [{ fr: 1 }, { fr: 1 }],
			},
			text(8, { overflow: "hidden" }),
			box(10, 10),
		),
	},
	{
		name: "explicit min width on an item widens a fraction track",
		root: node(
			{
				display: "grid",
				width: 100,
				gridTemplateColumns: [{ fr: 1 }, { fr: 1 }],
			},
			node({ minWidth: 70, height: 10 }),
			box(10, 10),
		),
	},
	{
		name: "padding keeps an item from collapsing",
		root: node(
			{ display: "grid", gridTemplateColumns: ["auto"] },
			node({ padding: { left: 10, right: 10 }, height: 10 }),
		),
	},
	{
		name: "aspect ratio sizes an item from its height",
		root: node(
			{ display: "grid", width: 200, gridTemplateColumns: [100, 100] },
			node({ height: 30, aspectRatio: 2, justifySelf: "start" }),
		),
	},
	{
		name: "aspect ratio sizes an item from its width in a column",
		root: node(
			{ display: "grid", width: 200, gridTemplateColumns: [100, 100] },
			node({ width: 60, aspectRatio: 2 }),
		),
	},
];
