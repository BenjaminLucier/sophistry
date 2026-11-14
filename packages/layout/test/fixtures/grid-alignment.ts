import type { LayoutStyle } from "../../src/index.ts";
import type { Fixture } from "../fixture.ts";
import { node, repeat, words } from "../fixture.ts";

const box = (width: number, height: number, style: LayoutStyle = {}) =>
	node({ width, height, ...style });
const container = (style: LayoutStyle = {}): LayoutStyle => ({
	display: "grid",
	width: 300,
	height: 200,
	gridTemplateColumns: [100, 100],
	gridTemplateRows: [60, 60],
	...style,
});

export const fixtures: Fixture[] = [
	{
		name: "items stretch to their areas",
		root: node(container(), node({}), node({}), node({}), node({})),
	},
	{
		name: "justify and align items start",
		root: node(
			container({ justifyItems: "start", alignItems: "flex-start" }),
			box(30, 20),
			box(30, 20),
		),
	},
	{
		name: "justify and align items end",
		root: node(
			container({ justifyItems: "end", alignItems: "flex-end" }),
			box(30, 20),
			box(30, 20),
		),
	},
	{
		name: "justify and align items center",
		root: node(
			container({ justifyItems: "center", alignItems: "center" }),
			box(30, 20),
			box(30, 20),
		),
	},
	{
		name: "self alignment overrides the container",
		root: node(
			container({ justifyItems: "end", alignItems: "flex-end" }),
			box(30, 20, { justifySelf: "start", alignSelf: "flex-start" }),
			box(30, 20, { justifySelf: "center", alignSelf: "center" }),
			box(30, 20, { justifySelf: "stretch" }),
			box(30, 20, { justifySelf: "auto" }),
		),
	},
	{
		name: "stretch without sizes fills the area",
		root: node(
			container({ justifyItems: "center" }),
			node({ justifySelf: "stretch", alignSelf: "stretch" }),
			node({ alignSelf: "center" }),
		),
	},
	{
		name: "content distribution center",
		root: node(
			container({ justifyContent: "center", alignContent: "center" }),
			box(30, 20),
			box(30, 20),
			box(30, 20),
			box(30, 20),
		),
	},
	{
		name: "content distribution end",
		root: node(
			container({ justifyContent: "flex-end", alignContent: "flex-end" }),
			box(30, 20),
			box(30, 20),
			box(30, 20),
			box(30, 20),
		),
	},
	{
		name: "content distribution space-between",
		root: node(
			container({
				justifyContent: "space-between",
				alignContent: "space-between",
				columnGap: 5,
			}),
			node({}),
			node({}),
			node({}),
			node({}),
		),
	},
	{
		name: "content distribution space-around",
		root: node(
			container({
				justifyContent: "space-around",
				alignContent: "space-around",
			}),
			node({}),
			node({}),
			node({}),
			node({}),
		),
	},
	{
		name: "content distribution space-evenly",
		root: node(
			container({
				justifyContent: "space-evenly",
				alignContent: "space-evenly",
			}),
			node({}),
			node({}),
			node({}),
			node({}),
		),
	},
	{
		name: "content distribution with no free space",
		root: node(
			container({
				width: 150,
				justifyContent: "space-between",
				alignContent: "center",
				gridTemplateRows: [120, 120],
			}),
			node({}),
			node({}),
			node({}),
			node({}),
		),
	},
	{
		name: "auto rows stretch with align-content",
		root: node(
			{
				display: "grid",
				width: 200,
				height: 200,
				gridTemplateColumns: [100],
			},
			box(50, 20),
			box(50, 20),
		),
	},
	{
		name: "auto rows do not stretch with align-content start",
		root: node(
			{
				display: "grid",
				width: 200,
				height: 200,
				alignContent: "flex-start",
				gridTemplateColumns: [100],
			},
			box(50, 20),
			box(50, 20),
		),
	},
	{
		name: "margins inside the area",
		root: node(
			container(),
			node({ margin: { top: 5, right: 7, bottom: 9, left: 11 } }),
			box(30, 20, { margin: { top: 5, left: 10 } }),
		),
	},
	{
		name: "percentage margins resolve against the area",
		root: node(
			container(),
			node({ margin: { top: "10%", left: "10%", right: "10%" } }),
		),
	},
	{
		name: "auto margins center an item",
		root: node(
			container(),
			box(30, 20, {
				margin: { top: "auto", right: "auto", bottom: "auto", left: "auto" },
			}),
		),
	},
	{
		name: "auto margins push an item to the end",
		root: node(
			container(),
			box(30, 20, { margin: { left: "auto", top: "auto" } }),
		),
	},
	{
		name: "auto margin on a stretched item shrinks it",
		root: node(container(), node({ height: 20, margin: { left: "auto" } })),
	},
	{
		name: "min and max sizes limit stretching",
		root: node(
			container(),
			node({ maxWidth: 40, maxHeight: 25 }),
			node({
				maxWidth: 40,
				justifySelf: "end",
				alignSelf: "center",
				maxHeight: 25,
			}),
		),
	},
	{
		name: "items sized by percentage of their area",
		root: node(
			container(),
			node({ width: "50%", height: "50%" }),
			node({ width: "80%", height: 10, justifySelf: "end" }),
		),
	},
	{
		name: "a spanning item aligns within its area",
		root: node(
			container({ columnGap: 20, rowGap: 10 }),
			box(30, 20, {
				gridColumn: { span: 2 },
				gridRow: { span: 2 },
				justifySelf: "center",
				alignSelf: "center",
			}),
		),
	},
	{
		name: "relative offsets move a grid item",
		root: node(
			container(),
			box(30, 20, { top: 5, left: 7 }),
			node({ right: 4, bottom: 3 }),
		),
	},
	{
		name: "absolute child at insets",
		root: node(
			container({ padding: { top: 10, left: 10 } }),
			box(30, 20, { position: "absolute", top: 5, left: 5 }),
			node({}),
		),
	},
	{
		name: "absolute child from the far corner",
		root: node(
			container(),
			box(30, 20, { position: "absolute", bottom: 5, right: 5 }),
			node({}),
		),
	},
	{
		name: "absolute child with both insets",
		root: node(
			container({ border: { top: 3, right: 3, bottom: 3, left: 3 } }),
			node({ position: "absolute", top: 10, left: 10, right: 20, bottom: 30 }),
		),
	},
	{
		name: "absolute child at the static position",
		root: node(
			container({ padding: { top: 8, left: 12 } }),
			box(30, 20, { position: "absolute" }),
		),
	},
	{
		name: "absolute child at the static position with a border",
		root: node(
			container({ border: { top: 4, left: 6, right: 2, bottom: 2 } }),
			box(30, 20, { position: "absolute" }),
		),
	},
	{
		name: "absolute child aligned at the static position",
		root: node(
			container({ justifyItems: "center", alignItems: "center" }),
			box(30, 20, { position: "absolute" }),
		),
	},
	{
		name: "absolute child with one inset on a centered grid",
		root: node(
			container({ justifyItems: "end", alignItems: "flex-end" }),
			box(30, 20, { position: "absolute", left: 10 }),
		),
	},
	{
		name: "text items stretch and wrap in their areas",
		root: node(
			container({ gridTemplateRows: ["auto", "auto"] }),
			words(repeat(8, 20, 10)),
			words(repeat(3, 20, 10)),
			words(repeat(5, 20, 10), { justifySelf: "start" }),
		),
	},
];
