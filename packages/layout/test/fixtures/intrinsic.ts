import type { Fixture } from "../fixture.ts";
import { node, repeat, words } from "../fixture.ts";

const text = (count: number, width = 20, height = 10) =>
	words(repeat(count, width, height));

export const fixtures: Fixture[] = [
	{
		name: "auto-width rows nest",
		root: node({}, node({ columnGap: 5 }, text(3), node({}, text(2))), text(1)),
	},
	{
		name: "root min width",
		root: node({ minWidth: 200 }, text(2)),
	},
	{
		name: "root max width wraps text",
		root: node({ maxWidth: 70, flexDirection: "column" }, text(8)),
	},
	{
		name: "percentage child of auto-sized parent",
		root: node({}, node({ width: "50%", height: 10 }), text(3)),
	},
	{
		name: "percentage margins and padding",
		root: node(
			{ width: 400, height: 100 },
			node({
				width: 50,
				height: 20,
				margin: { left: "10%", top: "5%" },
				padding: { right: "5%" },
			}),
		),
	},
	{
		name: "nested percentage widths",
		root: node(
			{ width: 400, height: 100 },
			node({ width: "50%" }, node({ width: "50%", height: 10 })),
		),
	},
	{
		name: "column auto height with zero bases",
		root: node(
			{ width: 100, flexDirection: "column" },
			{ ...text(6), style: { flexBasis: 0, flexGrow: 1 } },
			{ ...text(3), style: { flexBasis: 0, flexGrow: 1 } },
		),
	},
	{
		name: "column align center fits text",
		root: node(
			{ width: 100, flexDirection: "column", alignItems: "center" },
			text(7),
			text(2),
		),
	},
	{
		name: "column justify center auto height",
		root: node(
			{ width: 100, flexDirection: "column", justifyContent: "center" },
			text(2),
			text(3),
		),
	},
	{
		name: "row height from column child",
		root: node(
			{ width: 200 },
			node({ flexDirection: "column", width: 60 }, text(6)),
			node({ flexGrow: 1 }),
		),
	},
	{
		name: "shrinking text items",
		root: node(
			{ width: 120, alignItems: "flex-start" },
			text(5),
			text(5),
			text(5),
		),
	},
	{
		name: "max width smaller than text in column",
		root: node(
			{ width: 200, flexDirection: "column", alignItems: "flex-start" },
			{ ...text(8), style: { maxWidth: 50 } },
		),
	},
	{
		name: "stretch with cross margins",
		root: node(
			{ width: 300, height: 100 },
			node({ width: 50, margin: { top: 10, bottom: 20 } }),
		),
	},
	{
		name: "width percentage as flex basis",
		root: node(
			{ width: 300, height: 50 },
			node({ width: "40%" }),
			node({ width: "40%" }),
			node({ width: "40%" }),
		),
	},
	{
		name: "deep fit content",
		available: { width: 90, height: 1000 },
		root: node({}, node({ flexDirection: "column" }, node({}, text(7)))),
	},
];
