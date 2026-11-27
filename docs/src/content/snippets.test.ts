// Typechecks every ```tsx / ```ts code block that has an `import` in the docs
// pages (and the READMEs), so what the docs show is code a reader can paste.
//
// A block that is deliberately a fragment opts out with a meta marker:
//
//     ```tsx nocheck
//
// Blocks are written to a scratch directory inside `docs/` (so `@sophistry/*`
// and `solid-js` resolve through docs' node_modules exactly as in the docs
// typecheck) and compiled together by docs' own `tsc`, through a scratch
// tsconfig that extends docs' one.
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
	blocks.forEach((b, i) => {
		const name = join(
			scratch,
			`snippet-${String(i).padStart(4, "0")}.${b.lang}`,
		);
		writeFileSync(name, `${b.code}\nexport {};\n`);
		origin.set(name, `${b.file} (code block ${b.index})`);
	});

	// docs' compiler options, minus the unused-variable checks (a snippet that
	// imports something to show it off needn't use it). docs' `.d.ts` files come
	// along for the `astro/client` etc. ambient types, as in the docs typecheck.
	const tsconfig = join(scratch, "tsconfig.json");
	writeFileSync(
		tsconfig,
		JSON.stringify({
			extends: "../tsconfig.json",
			compilerOptions: {
				noEmit: true,
				noUnusedLocals: false,
				noUnusedParameters: false,
				incremental: false,
				skipLibCheck: true,
			},
			include: ["*.ts", "*.tsx", "../src/**/*.d.ts"],
		}),
	);

	const tscBin = join(
		dirname(
			createRequire(join(docsRoot, "package.json")).resolve(
				"typescript/package.json",
			),
		),
		"bin/tsc",
	);
	const run = spawnSync(
		process.execPath,
		[tscBin, "-p", tsconfig, "--pretty", "false"],
		{ cwd: docsRoot, encoding: "utf8" },
	);
	if (run.error) throw run.error;
	const output = `${run.stdout}${run.stderr}`;

	// `path(line,col): error TS1234: message`, with a chained message's further
	// lines indented beneath it. Only errors in the snippets count, as before.
	const failures: string[] = [];
	const DIAGNOSTIC = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/;
	let inSnippet = false;
	for (const line of output.split(/\r?\n/)) {
		const m = DIAGNOSTIC.exec(line);
		if (m) {
			const [, path = "", row, code, message] = m;
			const where = origin.get(resolve(docsRoot, path));
			inSnippet = where !== undefined;
			if (inSnippet) failures.push(`${where} line ${row}: ${code} ${message}`);
		} else if (inSnippet && /^\s+\S/.test(line)) {
			failures[failures.length - 1] += `\n${line.trim()}`;
		} else {
			inSnippet = false;
		}
	}
	// A non-zero exit with nothing attributed to a snippet means tsc itself
	// failed (bad config, crash) rather than a snippet; don't pass on that.
	if (run.status !== 0 && failures.length === 0) {
		expect.fail(`tsc exited ${run.status} without a snippet error:\n${output}`);
	}
	expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
}, 120_000);
