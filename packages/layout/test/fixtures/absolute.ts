import type { Fixture } from "../fixture.ts";
import { node, repeat, words } from "../fixture.ts";

export const fixtures: Fixture[] = [
	{
		name: "absolute with insets",
		root: node(
			{
				width: 300,
				height: 200,
				padding: { top: 10, right: 10, bottom: 10, left: 10 },
				border: { top: 2, right: 2, bottom: 2, left: 2 },
			},
			node({ position: "absolute", left: 20, top: 30, width: 50, height: 40 }),
			node({
				position: "absolute",
				right: 5,
				bottom: 5,
				width: 50,
				height: 40,
			}),
		),
	},
	{
		name: "absolute stretched by opposite insets",
		root: node(
			{ width: 300, height: 200 },
			node({ position: "absolute", left: 10, right: 20, top: 30, bottom: 40 }),
		),
	},
	{
		name: "absolute percentages",
		root: node(
			{ width: 300, height: 200 },
			node({
				position: "absolute",
				left: "10%",
				top: "50%",
				width: "50%",
				height: "25%",
			}),
		),
	},
	{
		name: "absolute static position centred",
		root: node(
			{
				width: 300,
				height: 200,
				justifyContent: "center",
				alignItems: "center",
			},
			node({ position: "absolute", width: 50, height: 40 }),
		),
	},
	{
		name: "absolute static position end",
		root: node(
			{
				width: 300,
				height: 200,
				justifyContent: "flex-end",
				alignItems: "flex-end",
				padding: { right: 10, bottom: 20 },
			},
			node({ position: "absolute", width: 50, height: 40 }),
		),
	},
	{
		name: "absolute text shrinks to fit",
		root: node(
			{ width: 100, height: 200 },
			{
				...words(repeat(6, 25, 10)),
				style: { position: "absolute", left: 10, top: 10 },
			},
		),
	},
	{
		name: "absolute does not take space",
		root: node(
			{ width: 300, height: 100 },
			node({ width: 50, height: 20 }),
			node({ position: "absolute", width: 100, height: 100, left: 0, top: 0 }),
			node({ width: 50, height: 20 }),
		),
	},
];
