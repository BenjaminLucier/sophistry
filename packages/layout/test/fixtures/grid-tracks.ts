import type { Fixture } from "../fixture.ts";
import { node, repeat, words } from "../fixture.ts";

const cell = (width?: number, height?: number) => node({ width, height });
const text = (count: number, width = 20, height = 10) =>
	words(repeat(count, width, height));

export const fixtures: Fixture[] = [
	{
		name: "fixed columns and rows",
		root: node(
			{
				display: "grid",
				gridTemplateColumns: [100, 50, 80],
				gridTemplateRows: [30, 40],
			},
			cell(),
			cell(),
			cell(),
			cell(),
			cell(),
		),
	},
	{
		name: "empty grid takes its tracks",
		root: node({
			display: "grid",
			gridTemplateColumns: [60, 40],
			gridTemplateRows: [25, 25],
			columnGap: 10,
			rowGap: 5,
		}),
	},
	{
		name: "gaps between tracks",
		root: node(
			{
				display: "grid",
				width: 300,
				gridTemplateColumns: [{ fr: 1 }, { fr: 1 }, { fr: 1 }],
				gridAutoRows: [20],
				columnGap: 12,
				rowGap: 8,
			},
			cell(),
			cell(),
			cell(),
			cell(),
			cell(),
		),
	},
	{
		name: "fractions share the free space",
		root: node(
			{
				display: "grid",
				width: 400,
				height: 100,
				gridTemplateColumns: [100, { fr: 1 }, { fr: 3 }],
			},
			cell(),
			cell(),
			cell(),
		),
	},
	{
		name: "fractions below one",
		root: node(
			{
				display: "grid",
				width: 400,
				gridTemplateColumns: [{ fr: 0.25 }, { fr: 0.25 }],
				gridAutoRows: [20],
			},
			cell(),
			cell(),
		),
	},
	{
		name: "percentage tracks",
		root: node(
			{
				display: "grid",
				width: 400,
				height: 200,
				gridTemplateColumns: ["25%", "50%"],
				gridTemplateRows: ["10%", "40%"],
			},
			cell(),
			cell(),
			cell(),
			cell(),
		),
	},
	{
		name: "percentage tracks of an auto-height grid",
		root: node(
			{
				display: "grid",
				width: 200,
				gridTemplateColumns: ["50%", "50%"],
				gridTemplateRows: ["50%"],
			},
			cell(undefined, 40),
			cell(undefined, 20),
		),
	},
	{
		name: "auto tracks stretch",
		root: node(
			{
				display: "grid",
				width: 300,
				gridTemplateColumns: [50, "auto", "auto"],
			},
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "auto columns size to content",
		root: node(
			{
				display: "grid",
				justifyContent: "flex-start",
				gridTemplateColumns: ["auto", "auto"],
			},
			text(3),
			text(5),
		),
	},
	{
		name: "min-content and max-content tracks",
		root: node(
			{
				display: "grid",
				width: 300,
				justifyContent: "flex-start",
				gridTemplateColumns: ["min-content", "max-content"],
			},
			text(4),
			text(4),
		),
	},
	{
		name: "minmax with a fraction",
		root: node(
			{
				display: "grid",
				width: 300,
				gridTemplateColumns: [
					{ minmax: [120, { fr: 1 }] },
					{ minmax: [50, { fr: 1 }] },
				],
			},
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "minmax fraction wins over minimum when space is short",
		root: node(
			{
				display: "grid",
				width: 150,
				gridTemplateColumns: [
					{ minmax: [100, { fr: 1 }] },
					{ minmax: [100, { fr: 1 }] },
				],
			},
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "minmax with zero minimum stops content blowout",
		root: node(
			{
				display: "grid",
				width: 100,
				gridTemplateColumns: [
					{ minmax: [0, { fr: 1 }] },
					{ minmax: [0, { fr: 1 }] },
				],
			},
			cell(80, 10),
			cell(80, 10),
		),
	},
	{
		name: "fraction tracks grow to unbreakable content",
		root: node(
			{
				display: "grid",
				width: 100,
				gridTemplateColumns: [{ fr: 1 }, { fr: 1 }],
			},
			cell(80, 10),
			cell(10, 10),
		),
	},
	{
		name: "fraction tracks and a width larger than the content",
		root: node(
			{
				display: "grid",
				width: 100,
				gridTemplateColumns: [{ fr: 1 }, { fr: 1 }],
			},
			{ ...text(2), style: { width: 80 } },
			cell(10, 10),
		),
	},
	{
		name: "minmax auto and a fixed maximum",
		root: node(
			{
				display: "grid",
				width: 300,
				justifyContent: "flex-start",
				gridTemplateColumns: [{ minmax: ["auto", 60] }, "auto"],
			},
			text(8),
			text(2),
		),
	},
	{
		name: "fit-content tracks",
		root: node(
			{
				display: "grid",
				justifyContent: "flex-start",
				gridTemplateColumns: [{ fitContent: 50 }, { fitContent: 200 }],
			},
			text(4),
			text(4),
		),
	},
	{
		name: "repeat with a count",
		root: node(
			{
				display: "grid",
				gridTemplateColumns: [{ repeat: 3, tracks: [40, 20] }],
			},
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "repeat of fractions",
		root: node(
			{
				display: "grid",
				width: 300,
				columnGap: 10,
				gridTemplateColumns: [{ repeat: 4, tracks: [{ fr: 1 }] }],
			},
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "auto-fill columns",
		root: node(
			{
				display: "grid",
				width: 350,
				columnGap: 10,
				gridTemplateColumns: [{ repeat: "auto-fill", tracks: [80] }],
			},
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "auto-fit collapses empty tracks",
		root: node(
			{
				display: "grid",
				width: 350,
				columnGap: 10,
				gridTemplateColumns: [
					{ repeat: "auto-fit", tracks: [{ minmax: [80, { fr: 1 }] }] },
				],
			},
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "auto-fill keeps empty tracks",
		root: node(
			{
				display: "grid",
				width: 350,
				columnGap: 10,
				gridTemplateColumns: [
					{ repeat: "auto-fill", tracks: [{ minmax: [80, { fr: 1 }] }] },
				],
			},
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "auto-fill with a maximum width",
		root: node(
			{
				display: "grid",
				maxWidth: 260,
				gridTemplateColumns: [{ repeat: "auto-fill", tracks: [100] }],
			},
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "auto-fill with a minimum width",
		root: node(
			{
				display: "grid",
				minWidth: 260,
				gridTemplateColumns: [{ repeat: "auto-fill", tracks: [100] }],
			},
			cell(undefined, 10),
		),
	},
	{
		name: "auto-fill of an auto-width grid is one track",
		root: node(
			{
				display: "grid",
				gridTemplateColumns: [{ repeat: "auto-fill", tracks: [100] }],
			},
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "auto-fit with a fixed column before",
		root: node(
			{
				display: "grid",
				width: 400,
				gridTemplateColumns: [30, { repeat: "auto-fit", tracks: [60] }],
			},
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "implicit rows from gridAutoRows",
		root: node(
			{
				display: "grid",
				width: 200,
				gridTemplateColumns: [{ fr: 1 }, { fr: 1 }],
				gridAutoRows: [20, 35],
			},
			cell(),
			cell(),
			cell(),
			cell(),
			cell(),
			cell(),
		),
	},
	{
		name: "implicit columns from gridAutoColumns",
		root: node(
			{
				display: "grid",
				gridAutoFlow: "column",
				gridTemplateRows: [20, 20],
				gridAutoColumns: [30, 50],
			},
			cell(),
			cell(),
			cell(),
			cell(),
			cell(),
		),
	},
	{
		name: "rows share an auto height",
		root: node(
			{ display: "grid", width: 200, gridTemplateColumns: [100, 100] },
			text(3),
			text(10),
			text(2),
		),
	},
	{
		name: "fraction rows in a tall grid",
		root: node(
			{
				display: "grid",
				width: 100,
				height: 300,
				gridTemplateRows: [{ fr: 1 }, { fr: 2 }, 30],
			},
			cell(),
			cell(),
			cell(),
		),
	},
	{
		name: "fraction rows of an auto-height grid size to content",
		root: node(
			{
				display: "grid",
				width: 100,
				gridTemplateRows: [{ fr: 1 }, { fr: 1 }],
			},
			cell(undefined, 40),
			cell(undefined, 10),
		),
	},
	{
		name: "min height grows fraction rows",
		root: node(
			{
				display: "grid",
				width: 100,
				minHeight: 200,
				gridTemplateRows: [{ fr: 1 }, { fr: 1 }],
			},
			cell(undefined, 40),
			cell(undefined, 10),
		),
	},
	{
		name: "padding and border around tracks",
		root: node(
			{
				display: "grid",
				width: 200,
				padding: { top: 10, right: 15, bottom: 10, left: 15 },
				border: { top: 2, right: 2, bottom: 2, left: 2 },
				gridTemplateColumns: [{ fr: 1 }, { fr: 1 }],
				columnGap: 6,
			},
			cell(undefined, 20),
			cell(undefined, 20),
		),
	},
	{
		name: "percentage gaps",
		root: node(
			{
				display: "grid",
				width: 200,
				height: 100,
				columnGap: "10%",
				rowGap: "10%",
				gridTemplateColumns: [{ fr: 1 }, { fr: 1 }],
				gridTemplateRows: [{ fr: 1 }, { fr: 1 }],
			},
			cell(),
			cell(),
			cell(),
			cell(),
		),
	},
	{
		name: "auto-fit collapses a gap in the middle",
		root: node(
			{
				display: "grid",
				width: 400,
				columnGap: 10,
				gridTemplateColumns: [{ repeat: "auto-fit", tracks: [50] }],
			},
			cell(undefined, 10),
			{ ...cell(undefined, 10), style: { gridColumn: 4, height: 10 } },
		),
	},
	{
		name: "auto-fit with items spanning tracks",
		root: node(
			{
				display: "grid",
				width: 400,
				columnGap: 10,
				gridTemplateColumns: [{ repeat: "auto-fit", tracks: [50] }],
			},
			{
				...cell(undefined, 10),
				style: { gridColumn: { span: 3 }, height: 10 },
			},
		),
	},
	{
		name: "auto-fit rows collapse",
		root: node(
			{
				display: "grid",
				height: 300,
				rowGap: 10,
				gridTemplateRows: [{ repeat: "auto-fit", tracks: [40] }],
			},
			cell(40, 10),
			cell(40, 10),
		),
	},
	{
		name: "mixed track types in one list",
		root: node(
			{
				display: "grid",
				width: 500,
				columnGap: 8,
				gridTemplateColumns: [
					40,
					"20%",
					{ minmax: [30, { fr: 1 }] },
					{ fitContent: 60 },
					"auto",
					{ fr: 2 },
				],
			},
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
			words(repeat(5, 20, 10)),
			words(repeat(2, 20, 10)),
			cell(undefined, 10),
		),
	},
	{
		name: "minmax with min-content and max-content",
		root: node(
			{
				display: "grid",
				width: 300,
				justifyContent: "flex-start",
				gridTemplateColumns: [
					{ minmax: ["min-content", "max-content"] },
					{ minmax: ["max-content", "max-content"] },
				],
			},
			words(repeat(6, 20, 10)),
			words(repeat(3, 20, 10)),
		),
	},
	{
		name: "minmax percentage",
		root: node(
			{
				display: "grid",
				width: 400,
				gridTemplateColumns: [{ minmax: ["10%", "30%"] }, "auto"],
			},
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "fraction tracks with gaps and a fixed track",
		root: node(
			{
				display: "grid",
				width: 300,
				columnGap: 20,
				gridTemplateColumns: [{ fr: 1 }, 60, { fr: 2 }],
			},
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
	{
		name: "fractions overflow when fixed tracks exceed the container",
		root: node(
			{
				display: "grid",
				width: 100,
				gridTemplateColumns: [80, 60, { fr: 1 }],
			},
			cell(undefined, 10),
			cell(undefined, 10),
			cell(undefined, 10),
		),
	},
];
