/**
 * The shape of a layout fixture. One description drives both sides: the
 * generator turns it into HTML and records what Chrome lays out, and the
 * test turns it into layout nodes and compares.
 *
 * A leaf may hold `words`: inline boxes `[width, height]` that wrap like
 * text with no spaces between them, so text-like measuring is tested
 * without depending on any font.
 */

import type { LayoutStyle } from "../src/index.js";

export interface FixtureNode {
	style?: LayoutStyle;
	children?: FixtureNode[];
	words?: [width: number, height: number][];
}

export interface Fixture {
	name: string;
	/** The space the root is laid out in. @default { width: 1000, height: 1000 } */
	available?: { width: number; height: number };
	root: FixtureNode;
}

/** What Chrome reported for one node. */
export interface ExpectedBox {
	x: number;
	y: number;
	width: number;
	height: number;
	children: ExpectedBox[];
}

/** A node with children. */
export function node(
	style: LayoutStyle,
	...children: FixtureNode[]
): FixtureNode {
	return { style, children };
}

/** A leaf of wrapping words. */
export function words(
	list: [number, number][],
	style: LayoutStyle = {},
): FixtureNode {
	return { style, words: list };
}

/** `count` words of the same size. */
export function repeat(
	count: number,
	width: number,
	height: number,
): [number, number][] {
	return Array.from(
		{ length: count },
		() => [width, height] as [number, number],
	);
}
