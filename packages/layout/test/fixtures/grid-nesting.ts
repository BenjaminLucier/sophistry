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
		name: "grid in a row flex container",
		root: node(
			{ width: 400, height: 100 },
			node(
				{ display: "grid", gridTemplateColumns: [40, 40], gridAutoRows: [20] },
				node({}),
				node({}),
				node({}),
			),
			node({ flexGrow: 1 }),
		),
	},
	{
		name: "auto-width grid as a flex item sizes to content",
		root: node(
			{ width: 400, height: 100, columnGap: 10 },
			node(
				{ display: "grid", gridTemplateColumns: ["auto", "auto"] },
				text(2),
				text(3),
			),
			node({ flexGrow: 1 }),
		),
	},
	{
		name: "grid item that grows in a flex row",
		root: node(
			{ width: 300, height: 80 },
			node(
				{
					display: "grid",
					flexGrow: 1,
					gridTemplateColumns: [{ fr: 1 }, { fr: 1 }],
				},
				node({}),
				node({}),
			),
			box(50, 20),
		),
	},
	{
		name: "grid in a column flex container stretches",
		root: node(
			{ width: 200, height: 300, flexDirection: "column" },
			node(
				{
					display: "grid",
					gridTemplateColumns: [{ fr: 1 }, { fr: 2 }],
					gridTemplateRows: [30],
				},
				node({}),
				node({}),
			),
			node({ flexGrow: 1 }),
		),
	},
	{
		name: "grid in a column flex container grows to fill",
		root: node(
			{ width: 200, height: 300, flexDirection: "column" },
			node(
				{
					display: "grid",
					flexGrow: 1,
					gridTemplateRows: [{ fr: 1 }, { fr: 1 }],
				},
				node({}),
				node({}),
			),
		),
	},
	{
		name: "grid in a column flex container with text",
		root: node(
			{ width: 100, flexDirection: "column" },
			node(
				{ display: "grid", gridTemplateColumns: [{ fr: 1 }, { fr: 1 }] },
				text(6),
				text(2),
			),
			box(50, 10),
		),
	},
	{
		name: "flex container in a grid cell",
		root: node(
			{
				display: "grid",
				width: 300,
				height: 100,
				gridTemplateColumns: [150, 150],
			},
			node({ columnGap: 5 }, box(30, 20), box(30, 20), node({ flexGrow: 1 })),
			node(
				{
					flexDirection: "column",
					justifyContent: "center",
					alignItems: "center",
				},
				box(30, 20),
			),
		),
	},
	{
		name: "flex container in an auto track",
		root: node(
			{ display: "grid", gridTemplateColumns: ["auto", "auto"] },
			node({ columnGap: 4 }, box(30, 20), box(30, 20)),
			node({ flexDirection: "column" }, text(2), box(50, 10)),
		),
	},
	{
		name: "flex wrap in a fixed cell",
		root: node(
			{ display: "grid", width: 200, gridTemplateColumns: [80, 120] },
			node({ flexWrap: "wrap" }, box(30, 10), box(30, 10), box(30, 10)),
			node({ flexWrap: "wrap" }, box(30, 10), box(30, 10), box(30, 10)),
		),
	},
	{
		name: "grid inside a grid",
		root: node(
			{
				display: "grid",
				width: 300,
				height: 200,
				gridTemplateColumns: [{ fr: 1 }, { fr: 2 }],
				columnGap: 10,
			},
			node({}),
			node(
				{
					display: "grid",
					gridTemplateColumns: ["25%", { fr: 1 }],
					gridTemplateRows: [{ fr: 1 }, 50],
					rowGap: 6,
				},
				node({}),
				node({}),
				node({ gridColumn: { span: 2 } }),
			),
		),
	},
	{
		name: "auto-sized grid inside an auto track",
		root: node(
			{ display: "grid", gridTemplateColumns: ["auto", "auto"] },
			node(
				{ display: "grid", gridTemplateColumns: [30, 30], gridAutoRows: [10] },
				node({}),
				node({}),
				node({}),
			),
			text(3),
		),
	},
	{
		name: "grid with a percentage width in a grid cell",
		root: node(
			{ display: "grid", width: 400, gridTemplateColumns: [200, 200] },
			node(
				{
					display: "grid",
					width: "50%",
					height: 40,
					gridTemplateColumns: [{ fr: 1 }, { fr: 1 }],
				},
				node({}),
				node({}),
			),
		),
	},
	{
		name: "grid with display none child",
		root: node(
			{ display: "grid", width: 100, gridTemplateColumns: [50, 50] },
			node({ display: "none", width: 10, height: 10 }, box(5, 5)),
			box(20, 20),
			box(20, 20),
		),
	},
	{
		name: "display none grid has no box",
		root: node(
			{ width: 200, height: 50 },
			node({ display: "none" }, box(10, 10)),
			node({ display: "grid", gridTemplateColumns: [30] }, box(10, 10)),
		),
	},
	{
		name: "absolute child in a nested grid",
		root: node(
			{
				display: "grid",
				width: 200,
				height: 100,
				gridTemplateColumns: [100, 100],
			},
			node(
				{ display: "grid", position: "relative" },
				box(10, 10, { position: "absolute", right: 0, bottom: 0 }),
			),
			node({}),
		),
	},
	{
		name: "flex item with percentage height inside a grid area",
		root: node(
			{
				display: "grid",
				width: 200,
				height: 100,
				gridTemplateColumns: [200],
				gridTemplateRows: [100],
			},
			node({ flexDirection: "column" }, node({ height: "50%" })),
		),
	},
	{
		name: "grid sets the height a column-flex cell stretches to",
		root: node(
			{ display: "grid", width: 200, gridTemplateColumns: [100, 100] },
			node({ flexDirection: "column" }, text(8)),
			node({ flexDirection: "column" }, text(2), node({ flexGrow: 1 })),
		),
	},
	{
		name: "shrinking grid in a narrow flex row",
		root: node(
			{ width: 100, height: 60 },
			node(
				{ display: "grid", gridTemplateColumns: ["auto", "auto"] },
				text(4),
				text(4),
			),
			box(60, 20),
		),
	},
	{
		name: "grid in a wrapping flex row",
		root: node(
			{ width: 200, flexWrap: "wrap" },
			node(
				{ display: "grid", gridTemplateColumns: [80, 40] },
				box(10, 10),
				box(10, 10),
			),
			node(
				{ display: "grid", gridTemplateColumns: [80, 40] },
				box(10, 10),
				box(10, 10),
			),
		),
	},
	{
		name: "flex items in grid cells with percentages",
		root: node(
			{
				display: "grid",
				width: 300,
				height: 100,
				gridTemplateColumns: [{ fr: 1 }, { fr: 1 }],
			},
			node({ columnGap: 10 }, box(30, 20), node({ width: "50%" })),
			node(
				{ flexDirection: "column", justifyContent: "space-between" },
				box(30, 20),
				box(30, 20),
			),
		),
	},
];
