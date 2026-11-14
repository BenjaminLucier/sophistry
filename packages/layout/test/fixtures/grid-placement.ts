import type { GridPlacement, LayoutStyle } from "../../src/index.ts";
import type { Fixture } from "../fixture.ts";
import { node } from "../fixture.ts";

const cell = (style: LayoutStyle = {}) => node({ height: 10, ...style });
const at = (column?: GridPlacement, row?: GridPlacement) =>
	cell({ gridColumn: column, gridRow: row });
const container = (style: LayoutStyle = {}): LayoutStyle => ({
	display: "grid",
	width: 300,
	gridTemplateColumns: [{ repeat: 3, tracks: [{ fr: 1 }] }],
	gridAutoRows: [20],
	...style,
});

export const fixtures: Fixture[] = [
	{
		name: "explicit lines",
		root: node(
			container(),
			at(2, 2),
			at({ start: 1, end: 3 }, 1),
			at({ start: 3 }, { start: 3, end: 5 }),
		),
	},
	{
		name: "spans",
		root: node(
			container({ columnGap: 10, rowGap: 4 }),
			at({ span: 2 }),
			at(),
			at({ start: 2, span: 2 }),
			at({ end: 3, span: 2 }, { span: 2 }),
		),
	},
	{
		name: "negative lines",
		root: node(
			container(),
			at(-1, 1),
			at({ start: -2, end: -1 }, 2),
			at({ start: 1, end: -1 }, 3),
		),
	},
	{
		name: "end line only",
		root: node(container(), at({ end: 3 }, { end: 3 }), at({ end: 2 })),
	},
	{
		name: "reversed lines swap",
		root: node(
			container(),
			at({ start: 3, end: 1 }, 1),
			at({ start: 2, end: 2 }, 2),
		),
	},
	{
		name: "items beyond the explicit grid make implicit tracks",
		root: node(container({ gridAutoColumns: [40] }), at(5, 1), at(2, 4)),
	},
	{
		name: "negative lines before the explicit grid",
		root: node(
			container({ gridTemplateColumns: [50, 50], gridAutoColumns: [30, 20] }),
			at(-4, 1),
			at(1, 1),
			at(-3, 2),
		),
	},
	{
		name: "sparse auto-placement skips occupied cells",
		root: node(container(), at(2, 1), at(), at(), at(), at({ span: 2 }), at()),
	},
	{
		name: "sparse placement continues past a wide item",
		root: node(container(), at({ span: 2 }), at({ span: 2 }), at(), at()),
	},
	{
		name: "dense placement backfills holes",
		root: node(
			container({ gridAutoFlow: "row dense" }),
			at({ span: 2 }),
			at({ span: 2 }),
			at(),
			at(),
		),
	},
	{
		name: "column flow",
		root: node(
			{
				display: "grid",
				gridAutoFlow: "column",
				gridTemplateRows: [20, 20],
				gridAutoColumns: [50],
			},
			at(),
			at(),
			at(),
			at(),
			at(),
		),
	},
	{
		name: "column flow dense",
		root: node(
			{
				display: "grid",
				gridAutoFlow: "column dense",
				gridTemplateRows: [20, 20, 20],
				gridAutoColumns: [50],
			},
			cell({ gridRow: { span: 2 } }),
			cell({ gridRow: { span: 2 } }),
			at(),
			at(),
		),
	},
	{
		name: "items locked to a row in sparse flow",
		root: node(
			container(),
			at(undefined, 2),
			at(undefined, 2),
			at(undefined, 1),
			at(),
			at(),
		),
	},
	{
		name: "items locked to a column",
		root: node(container(), at(2), at(2), at(1), at(), at()),
	},
	{
		name: "items locked to a column in dense flow",
		root: node(
			container({ gridAutoFlow: "row dense" }),
			at(3),
			at(1),
			at(3),
			at(),
			at(),
		),
	},
	{
		name: "overlapping explicit items",
		root: node(
			container(),
			at({ start: 1, end: 3 }, 1),
			at({ start: 2, end: 4 }, 1),
		),
	},
	{
		name: "spans wider than the explicit grid",
		root: node(
			container({ gridTemplateColumns: [50, 50] }),
			at({ span: 4 }),
			at(),
		),
	},
	{
		name: "display none items take no cell",
		root: node(container(), at(), cell({ display: "none" }), at(), at()),
	},
];
