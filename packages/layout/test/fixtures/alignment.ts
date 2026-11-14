import type {
	AlignContent,
	AlignItems,
	JustifyContent,
} from "../../src/index.ts";
import type { Fixture } from "../fixture.ts";
import { node } from "../fixture.ts";

const items = () => [
	node({ width: 40, height: 20 }),
	node({ width: 50, height: 30 }),
	node({ width: 60, height: 40 }),
];

const justify: JustifyContent[] = [
	"flex-start",
	"flex-end",
	"center",
	"space-between",
	"space-around",
	"space-evenly",
];
const align: AlignItems[] = ["flex-start", "flex-end", "center", "stretch"];
const content: AlignContent[] = [
	"flex-start",
	"flex-end",
	"center",
	"stretch",
	"space-between",
	"space-around",
	"space-evenly",
];

export const fixtures: Fixture[] = [
	...justify.map((mode) => ({
		name: `justify ${mode}`,
		root: node({ width: 300, height: 100, justifyContent: mode }, ...items()),
	})),
	...justify.map((mode) => ({
		name: `justify ${mode} overflowing`,
		root: node(
			{ width: 100, height: 100, justifyContent: mode },
			...items().map((item) => ({
				...item,
				style: { ...item.style, flexShrink: 0 },
			})),
		),
	})),
	...align.map((mode) => ({
		name: `align items ${mode}`,
		root: node(
			{ width: 300, height: 100, alignItems: mode },
			node({ width: 40, height: 20 }),
			node({ width: 50 }),
		),
	})),
	{
		name: "align self overrides",
		root: node(
			{ width: 300, height: 100, alignItems: "flex-end" },
			node({ width: 40, height: 20, alignSelf: "center" }),
			node({ width: 40, height: 20 }),
			node({ width: 40, alignSelf: "stretch" }),
		),
	},
	...content.map((mode) => ({
		name: `align content ${mode}`,
		root: node(
			{ width: 120, height: 200, flexWrap: "wrap", alignContent: mode },
			...items(),
		),
	})),
	{
		name: "row reverse",
		root: node(
			{ width: 300, height: 100, flexDirection: "row-reverse" },
			...items(),
		),
	},
	{
		name: "column reverse with justify",
		root: node(
			{
				width: 100,
				height: 300,
				flexDirection: "column-reverse",
				justifyContent: "center",
			},
			...items(),
		),
	},
	{
		name: "wrap reverse",
		root: node(
			{
				width: 120,
				height: 200,
				flexWrap: "wrap-reverse",
				alignContent: "flex-start",
			},
			...items(),
		),
	},
	{
		name: "stretch respects max cross",
		root: node({ width: 300, height: 100 }, node({ width: 50, maxHeight: 60 })),
	},
];
