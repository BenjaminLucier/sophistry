import type { Fixture } from "../fixture.ts";
import { node } from "../fixture.ts";

export const fixtures: Fixture[] = [
	{
		name: "grow equally",
		root: node(
			{ width: 300, height: 50 },
			node({ flexGrow: 1 }),
			node({ flexGrow: 1 }),
		),
	},
	{
		name: "grow by factor with bases",
		root: node(
			{ width: 400, height: 50 },
			node({ flexGrow: 1, flexBasis: 50 }),
			node({ flexGrow: 3, flexBasis: 100 }),
		),
	},
	{
		name: "grow factors below one",
		root: node(
			{ width: 400, height: 50 },
			node({ flexGrow: 0.2, flexBasis: 100 }),
			node({ flexGrow: 0.3, flexBasis: 100 }),
		),
	},
	{
		name: "grow clamped by max",
		root: node(
			{ width: 400, height: 50 },
			node({ flexGrow: 1, maxWidth: 50 }),
			node({ flexGrow: 1 }),
		),
	},
	{
		name: "shrink by base size",
		root: node(
			{ width: 200, height: 50 },
			node({ width: 200, flexShrink: 1 }),
			node({ width: 100, flexShrink: 1 }),
		),
	},
	{
		name: "shrink clamped by min",
		root: node(
			{ width: 200, height: 50 },
			node({ width: 200, minWidth: 150 }),
			node({ width: 200 }),
		),
	},
	{
		name: "no shrink overflows",
		root: node(
			{ width: 200, height: 50 },
			node({ width: 150, flexShrink: 0 }),
			node({ width: 150, flexShrink: 0 }),
		),
	},
	{
		name: "basis percentage",
		root: node(
			{ width: 400, height: 50 },
			node({ flexBasis: "25%" }),
			node({ flexBasis: "50%", flexGrow: 1 }),
		),
	},
	{
		name: "basis zero with padding",
		root: node(
			{ width: 300, height: 50 },
			node({ flexBasis: 0, flexGrow: 1, padding: { left: 40 } }),
			node({ flexBasis: 0, flexGrow: 1 }),
		),
	},
	{
		name: "column grow",
		root: node(
			{ width: 100, height: 300, flexDirection: "column" },
			node({ flexGrow: 1 }),
			node({ height: 50 }),
			node({ flexGrow: 2 }),
		),
	},
	{
		name: "auto margins centre",
		root: node(
			{ width: 300, height: 100 },
			node({
				width: 50,
				height: 50,
				margin: { top: "auto", right: "auto", bottom: "auto", left: "auto" },
			}),
		),
	},
	{
		name: "auto margin pushes",
		root: node(
			{ width: 300, height: 100 },
			node({ width: 50, height: 50 }),
			node({ width: 50, height: 50, margin: { left: "auto" } }),
		),
	},
	{
		name: "border-box item never smaller than its padding",
		root: node(
			{ width: 100, height: 50 },
			node({ width: 10, padding: { left: 30, right: 30 } }),
		),
	},
];
