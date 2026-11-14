import type { Fixture } from "../fixture.ts";
import { node } from "../fixture.ts";

const box = (width: number, height: number, extra = {}) =>
	node({ width, height, ...extra });

export const fixtures: Fixture[] = [
	{ name: "fixed root", root: node({ width: 200, height: 100 }) },
	{
		name: "row of fixed items",
		root: node(
			{ width: 300, height: 100 },
			box(50, 20),
			box(60, 30),
			box(70, 40),
		),
	},
	{
		name: "root sized by content",
		root: node({}, box(50, 20), box(60, 30)),
	},
	{
		name: "root fit-content capped by available",
		available: { width: 100, height: 500 },
		root: node({ flexWrap: "wrap" }, box(60, 20), box(60, 20), box(60, 20)),
	},
	{
		name: "padding and border",
		root: node(
			{
				width: 200,
				height: 100,
				padding: { top: 5, right: 10, bottom: 15, left: 20 },
				border: { top: 1, right: 2, bottom: 3, left: 4 },
			},
			box(30, 30),
		),
	},
	{
		name: "margins on items",
		root: node(
			{ width: 300, height: 100 },
			box(50, 20, { margin: { top: 5, right: 10, bottom: 0, left: 15 } }),
			box(50, 20, { margin: { left: 7 } }),
		),
	},
	{
		name: "percentage sizes",
		root: node(
			{ width: 400, height: 200 },
			node({ width: "25%", height: "50%" }),
			node({ width: "50%", height: "10%", padding: { left: "5%" } }),
		),
	},
	{
		name: "display none",
		root: node(
			{ width: 300, height: 100 },
			box(50, 20),
			box(60, 30, { display: "none" }),
			box(70, 40),
		),
	},
	{
		name: "column gap and row gap",
		root: node(
			{ width: 300, height: 100, columnGap: 10, rowGap: 20, flexWrap: "wrap" },
			box(100, 20),
			box(100, 20),
			box(100, 20),
		),
	},
	{
		name: "nested containers",
		root: node(
			{
				width: 400,
				height: 300,
				padding: { top: 10, right: 10, bottom: 10, left: 10 },
			},
			node(
				{
					flexDirection: "column",
					padding: { top: 5, right: 5, bottom: 5, left: 5 },
				},
				box(40, 20),
				box(60, 20),
			),
			node({ flexGrow: 1 }, box(30, 30)),
		),
	},
	{
		name: "aspect ratio from width",
		root: node(
			{ width: 300, height: 300, alignItems: "flex-start" },
			node({ width: 100, aspectRatio: 2 }),
		),
	},
	{
		name: "aspect ratio from height",
		root: node(
			{ width: 300, height: 300, alignItems: "flex-start" },
			node({ height: 60, aspectRatio: 0.5 }),
		),
	},
	{
		name: "relative offsets",
		root: node(
			{ width: 300, height: 100 },
			box(50, 20, { left: 10, top: 5 }),
			box(50, 20, { right: 10, bottom: 5 }),
		),
	},
];
