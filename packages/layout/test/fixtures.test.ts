/// <reference types="vite/client" />
/**
 * Compares the engine with Chrome over every fixture. The expected boxes are
 * recorded by `scripts/generate-expected.ts`; see `test/fixture.ts`.
 */

import { describe, expect, it } from "vitest";
import type { LayoutBox, LayoutNode } from "../src/index.ts";
import { computeLayout } from "../src/index.ts";
import type { ExpectedBox, Fixture, FixtureNode } from "./fixture.ts";
import { measureWords } from "./measure.ts";

const modules = import.meta.glob<Fixture[]>(
	["./fixtures/*.ts", "!./fixtures/*.d.ts"],
	{ eager: true, import: "fixtures" },
);
const recorded = import.meta.glob<Record<string, ExpectedBox>>(
	"./fixtures/*.expected.json",
	{ eager: true, import: "default" },
);

/** Chrome lays out in 1/64 px units; positions accumulate that rounding. */
const TOLERANCE = 0.05;

function toNode(fixture: FixtureNode): LayoutNode {
	if (fixture.words) {
		return { style: fixture.style, measure: measureWords(fixture.words) };
	}
	return {
		style: fixture.style,
		children: (fixture.children ?? []).map(toNode),
	};
}

/** Every mismatch between the two trees, as readable lines. */
function differences(
	actual: LayoutBox,
	expected: ExpectedBox,
	path = "root",
): string[] {
	const found: string[] = [];
	for (const key of ["x", "y", "width", "height"] as const) {
		if (Math.abs(actual[key] - expected[key]) > TOLERANCE) {
			found.push(
				`${path}.${key}: expected ${expected[key]}, got ${actual[key]}`,
			);
		}
	}
	expected.children.forEach((child, index) => {
		const other = actual.children[index];
		if (!other) found.push(`${path}[${index}]: missing`);
		else found.push(...differences(other, child, `${path}[${index}]`));
	});
	return found;
}

for (const [file, fixtures] of Object.entries(modules)) {
	const expected = recorded[file.replace(/\.ts$/, ".expected.json")];
	describe(file.replace("./fixtures/", ""), () => {
		it("has recorded results", () => {
			expect(expected, `run the fixtures script for ${file}`).toBeDefined();
		});
		for (const fixture of fixtures) {
			it(fixture.name, () => {
				const box = expected?.[fixture.name];
				expect(
					box,
					"no recorded result; run the fixtures script",
				).toBeDefined();
				const layout = computeLayout(
					toNode(fixture.root),
					fixture.available ?? { width: 1000, height: 1000 },
				);
				expect(differences(layout, box as ExpectedBox)).toEqual([]);
			});
		}
	});
}
