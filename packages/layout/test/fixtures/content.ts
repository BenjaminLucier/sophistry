import type { Fixture } from "../fixture.ts";
import { node, repeat, words } from "../fixture.ts";

export const fixtures: Fixture[] = [
	{ name: "text leaf fits content", root: node({}, words(repeat(5, 20, 10))) },
	{
		name: "text wraps in fixed row",
		root: node(
			{ width: 70, height: 100, alignItems: "flex-start" },
			words(repeat(5, 20, 10)),
		),
	},
	{
		name: "text shrinks to min content",
		root: node(
			{ width: 100, height: 100, alignItems: "flex-start" },
			words(repeat(4, 30, 10)),
			words(repeat(4, 30, 10)),
		),
	},
	{
		name: "text in column wraps to width",
		root: node(
			{ width: 70, flexDirection: "column" },
			words(repeat(6, 20, 10)),
			words(repeat(2, 30, 15)),
		),
	},
	{
		name: "column root fit-content",
		available: { width: 75, height: 1000 },
		root: node({ flexDirection: "column" }, words(repeat(6, 20, 10))),
	},
	{
		name: "text with padding",
		root: node(
			{ width: 100, flexDirection: "column" },
			words(repeat(6, 20, 10), {
				padding: { top: 5, right: 10, bottom: 5, left: 10 },
			}),
		),
	},
	{
		name: "grow beside text",
		root: node(
			{ width: 200, height: 50, alignItems: "flex-start" },
			words(repeat(3, 30, 10)),
			node({ flexGrow: 1, height: 10 }),
		),
	},
	{
		name: "overflow hidden shrinks below content",
		root: node(
			{ width: 50, height: 50, alignItems: "flex-start" },
			words(repeat(2, 40, 10), { overflow: "hidden" }),
		),
	},
	{
		name: "nested row in column",
		root: node(
			{ width: 150, flexDirection: "column", rowGap: 5 },
			node(
				{ columnGap: 10 },
				words(repeat(4, 20, 10)),
				words(repeat(4, 20, 10)),
			),
			words(repeat(3, 25, 12)),
		),
	},
	{
		name: "mixed word heights",
		root: node(
			{ width: 60, flexDirection: "column" },
			words([
				[20, 10],
				[30, 20],
				[25, 5],
				[10, 15],
			]),
		),
	},
];
