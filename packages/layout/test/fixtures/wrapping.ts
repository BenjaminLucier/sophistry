import type { Fixture } from "../fixture.ts";
import { node } from "../fixture.ts";

const box = (width: number, height: number, extra = {}) =>
	node({ width, height, ...extra });

export const fixtures: Fixture[] = [
	{
		name: "wrap grows within each line",
		root: node(
			{ width: 200, flexWrap: "wrap" },
			box(80, 20, { flexGrow: 1 }),
			box(80, 20, { flexGrow: 1 }),
			box(80, 20, { flexGrow: 1 }),
		),
	},
	{
		name: "wrap lines take tallest item",
		root: node(
			{ width: 150, flexWrap: "wrap", alignItems: "flex-start" },
			box(60, 20),
			box(60, 50),
			box(60, 30),
			box(60, 10),
		),
	},
	{
		name: "column wrap with max height",
		root: node(
			{ flexDirection: "column", flexWrap: "wrap", maxHeight: 100 },
			box(30, 40),
			box(40, 40),
			box(50, 40),
		),
	},
	{
		name: "column wrap with fixed height",
		root: node(
			{
				width: 200,
				height: 100,
				flexDirection: "column",
				flexWrap: "wrap",
				columnGap: 10,
			},
			box(30, 40),
			box(40, 40),
			box(50, 40),
		),
	},
	{
		name: "min height stretches lines",
		root: node(
			{ width: 120, minHeight: 200, flexWrap: "wrap" },
			box(60, 20),
			box(60, 20),
			node({ width: 60 }),
		),
	},
	{
		name: "align content with gaps",
		root: node(
			{
				width: 120,
				height: 200,
				flexWrap: "wrap",
				rowGap: 10,
				alignContent: "space-between",
			},
			box(60, 20),
			box(60, 20),
			box(60, 20),
			box(60, 20),
			box(60, 20),
		),
	},
	{
		name: "item wider than line gets its own",
		root: node(
			{ width: 100, flexWrap: "wrap" },
			box(40, 10),
			box(150, 10, { flexShrink: 0 }),
			box(40, 10),
		),
	},
	{
		name: "grow hits max then others take rest",
		root: node(
			{ width: 400, height: 20 },
			node({ flexGrow: 1, maxWidth: 60 }),
			node({ flexGrow: 1, maxWidth: 80 }),
			node({ flexGrow: 2 }),
		),
	},
	{
		name: "grow with min violation",
		root: node(
			{ width: 200, height: 20 },
			node({ flexGrow: 1, minWidth: 150 }),
			node({ flexGrow: 1 }),
		),
	},
];
