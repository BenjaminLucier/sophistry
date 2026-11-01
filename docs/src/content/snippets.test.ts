// Typechecks every ```tsx / ```ts code block that has an `import` in the docs
// pages (and the READMEs), so what the docs show is code a reader can paste.
//
// A block that is deliberately a fragment opts out with a meta marker:
//
//     ```tsx nocheck
//
// Blocks are written to a scratch directory inside `docs/` (so `@sophistry/*`
// and `solid-js` resolve through docs' node_modules exactly as in the docs
// typecheck) and compiled together with the compiler API.
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, expect, test } from "vitest";

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = join(docsRoot, "..");
const pagesRoot = join(docsRoot, "src/content/docs");
const scratch = join(docsRoot, `.snippets-${process.pid}`);

function* walk(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			yield* walk(path);
		} else if (/\.mdx?$/.test(name)) yield path;
	}
}

interface Block {
	file: string;
	index: number;
	lang: "ts" | "tsx";
	code: string;
}

const FENCE = /^([ \t]*)```(tsx|ts)([^\n]*)\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;

function extract(path: string): Block[] {
	const text = readFileSync(path, "utf8");
	const file = relative(repoRoot, path);
	const blocks: Block[] = [];
	let index = 0;
	for (const m of text.matchAll(FENCE)) {
		const [, indent = "", lang, meta = "", body = ""] = m;
		index++;
		if (/\bnocheck\b/.test(meta)) continue;
		if (!/^\s*import\b/m.test(body)) continue;
		const code = body
			.split("\n")
			.map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
			.join("\n");
		blocks.push({ file, index, lang: lang as "ts" | "tsx", code });
	}
	return blocks;
}

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("every importing code block in the docs typechecks", () => {
	const sources = [
		...walk(pagesRoot),
		join(repoRoot, "README.md"),
		...["core", "text", "charts", "3d", "solidjs"].map((name) =>
			join(repoRoot, `packages/${name}/README.md`),
		),
	];
	const blocks = sources.flatMap(extract);
	expect(blocks.length).toBeGreaterThan(20);

	rmSync(scratch, { recursive: true, force: true });
	mkdirSync(scratch, { recursive: true });
	const origin = new Map<string, string>();
	const files: string[] = [];
	blocks.forEach((b, i) => {
		const name = join(
			scratch,
			`snippet-${String(i).padStart(4, "0")}.${b.lang}`,
		);
		writeFileSync(name, `${b.code}\nexport {};\n`);
		origin.set(name, `${b.file} (code block ${b.index})`);
		files.push(name);
	});

	const cfgPath = join(docsRoot, "tsconfig.json");
	const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
	const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, docsRoot);
	const options: ts.CompilerOptions = {
		...parsed.options,
		noEmit: true,
		noUnusedLocals: false,
		noUnusedParameters: false,
		incremental: false,
		skipLibCheck: true,
	};
	// Pull in `astro/client` etc. ambient types the same way the docs do.
	const program = ts.createProgram({
		rootNames: [
			...files,
			...parsed.fileNames.filter((f) => f.endsWith(".d.ts")),
		],
		options,
	});

	const failures: string[] = [];
	for (const file of files) {
		const sf = program.getSourceFile(file);
		if (!sf) continue;
		const diags = [
			...program.getSyntacticDiagnostics(sf),
			...program.getSemanticDiagnostics(sf),
		];
		for (const d of diags) {
			const pos =
				d.start !== undefined
					? sf.getLineAndCharacterOfPosition(d.start)
					: undefined;
			failures.push(
				`${origin.get(file)} line ${pos ? pos.line + 1 : "?"}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
			);
		}
	}
	expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
}, 120_000);
