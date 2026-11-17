import { describe, expect, it } from "vitest";
import { leadingImportRange } from "./collapse-imports.mjs";

const range = (source: string) => leadingImportRange(source.split("\n"));

describe("leadingImportRange", () => {
	it("covers consecutive single-line imports", () => {
		expect(
			range('import { a } from "x";\nimport { b } from "y";\n\nconst c = 1;'),
		).toEqual({ from: 1, to: 2 });
	});

	it("covers a multi-line import", () => {
		expect(
			range('import {\n\ta,\n\tb,\n} from "x";\nimport "y";\n\nexport {};'),
		).toEqual({ from: 1, to: 5 });
	});

	it("leaves leading comments open and folds blank lines between imports", () => {
		expect(
			range('// note\nimport a from "a";\n\nimport b from "b";\nlet x;'),
		).toEqual({ from: 2, to: 4 });
	});

	it("skips a single import", () => {
		expect(range('import a from "a";\n\nlet x;')).toBeUndefined();
	});

	it("skips code without leading imports", () => {
		expect(range('const a = 1;\nimport b from "b";')).toBeUndefined();
	});

	it("skips an unfinished import", () => {
		expect(range("import {\n\ta,")).toBeUndefined();
	});
});
