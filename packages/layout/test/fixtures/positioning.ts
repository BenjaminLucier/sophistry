import type { Fixture } from "../fixture.ts";
import { node } from "../fixture.ts";

export const fixtures: Fixture[] = [
	{
		name: "absolute with margins",
		root: node(
			{ width: 300, height: 200 },
			node({
				position: "absolute",
				left: 10,
				top: 10,
				width: 50,
				height: 50,
				margin: { left: 5, top: 15 },
			}),
			node({
				position: "absolute",
				right: 10,
				bottom: 10,
				width: 50,
				height: 50,
				margin: { right: 5, bottom: 15 },
			}),
		),
	},
	{
		name: "absolute aspect ratio",
		root: node(
			{ width: 300, height: 200 },
			node({
				position: "absolute",
				left: 0,
				top: 0,
				width: 100,
				aspectRatio: 4,
			}),
		),
	},
	{
		name: "absolute static in column reverse",
		root: node(
			{ width: 300, height: 200, flexDirection: "column-reverse" },
			node({ position: "absolute", width: 50, height: 40 }),
		),
	},
	{
		name: "absolute one inset per axis",
		root: node(
			{
				width: 300,
				height: 200,
				justifyContent: "center",
				alignItems: "flex-end",
			},
			node({ position: "absolute", left: 20, width: 50, height: 40 }),
		),
	},
	{
		name: "absolute min and max",
		root: node(
			{ width: 300, height: 200 },
			node({
				position: "absolute",
				left: 0,
				right: 0,
				top: 0,
				height: 10,
				maxWidth: 120,
			}),
			node({
				position: "absolute",
				left: 0,
				top: 50,
				width: 10,
				height: 10,
				minWidth: 40,
			}),
		),
	},
	{
		name: "absolute inside nested padding",
		root: node(
			{
				width: 300,
				height: 200,
				padding: { top: 20, right: 20, bottom: 20, left: 20 },
			},
			node(
				{
					width: 150,
					height: 100,
					border: { top: 5, right: 5, bottom: 5, left: 5 },
				},
				node({ position: "absolute", left: 0, top: 0, width: 10, height: 10 }),
			),
		),
	},
];
