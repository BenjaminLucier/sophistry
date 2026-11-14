// Typechecks every fenced code block under an `@example` tag in the JSDoc of
// the `@sophistry/*` packages. Each block must be a self-contained module
// (its own imports from "@sophistry/core[/geometry|/color|/themes]",
// "@sophistry/text", "@sophistry/box", "@sophistry/charts[/3d]", "@sophistry/3d",
// "@sophistry/solidjs[/...]" or "@sophistry/react[/...]"), so what
// an editor shows on hover is code a reader can paste and compile.
//
//   node scripts/check-examples.mjs [path-substring ...]
//
// With arguments, only source files whose path contains one of them are
// scanned (e.g. `core/src/anim`, `charts/`).
//
// Blocks are compiled from inside a binding package, which depends on every
// source package, so their imports resolve exactly as a user's would:
// blocks from the React bindings in `packages/react` (React JSX), all the
// others in `packages/solidjs` (Solid JSX, so a core example may show a
// `<Stage>`). Output goes to a per-process directory in each, so concurrent
// runs do not collide.
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packages = join(dirname(fileURLToPath(import.meta.url)), "../..");
const repo = join(packages, "..");
const SOURCES = ["core", "text", "box", "charts", "3d", "solidjs", "react"];
const filters = process.argv.slice(2);

/** Where each package's blocks compile: the binding whose JSX they use. */
const hostOf = (pkg) => (pkg === "react" ? "react" : "solidjs");

function* walk(dir) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (name !== "node_modules" && !name.startsWith(".")) yield* walk(path);
		} else if (/\.tsx?$/.test(name) && !/\.(test|bench|d)\.tsx?$/.test(name))
			yield path;
	}
}

/** Per host package: its output directory and block origins. */
const hosts = new Map();
function hostDir(host) {
	let entry = hosts.get(host);
	if (!entry) {
		const out = join(packages, host, `.examples-${process.pid}`);
		mkdirSync(out, { recursive: true });
		entry = { out, origin: new Map(), count: 0 };
		hosts.set(host, entry);
	}
	return entry;
}

process.on("exit", () => {
	for (const { out } of hosts.values())
		rmSync(out, { recursive: true, force: true });
});

let total = 0;
for (const pkg of SOURCES) {
	const src = join(packages, pkg, "src");
	if (!existsSync(src)) continue;
	for (const file of walk(src)) {
		if (filters.length && !filters.some((f) => file.includes(f))) continue;
		// Generated entries carry no hand-written examples.
		if (file.includes("/generated/")) continue;
		const text = readFileSync(file, "utf8");
		for (const [block] of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
			const body = block
				.split("\n")
				.map((l) => l.replace(/^\s*\/?\*+\/?\s?/, ""))
				.join("\n");
			for (const [, section] of body.matchAll(
				/@example([\s\S]*?)(?=\n@[a-z]+|$)/g,
			)) {
				for (const [, lang, code] of section.matchAll(
					/```(tsx?)\n([\s\S]*?)```/g,
				)) {
					const host = hostDir(hostOf(pkg));
					const name = `example-${String(++host.count).padStart(4, "0")}.${lang}`;
					writeFileSync(join(host.out, name), `${code}\nexport {};\n`);
					host.origin.set(name, relative(repo, file));
					total++;
				}
			}
		}
	}
}

if (total === 0) {
	console.log("no @example blocks found");
	process.exit(0);
}

let failed = false;
for (const [host, { out, origin, count }] of hosts) {
	writeFileSync(
		join(out, "tsconfig.json"),
		JSON.stringify({
			extends: "../tsconfig.json",
			compilerOptions: {
				tsBuildInfoFile: "./.tsbuildinfo",
				noUnusedLocals: false,
				noUnusedParameters: false,
			},
			// Ambient declarations the source packages rely on (asset imports,
			// opentype.js, raw text imports).
			include: ["./*.ts", "./*.tsx", "../../*/src/**/*.d.ts"],
			exclude: ["../../sophistry/**"],
		}),
	);
	const tsc = join(packages, host, "node_modules/.bin/tsc");
	const res = spawnSync(tsc, ["-p", join(out, "tsconfig.json")], {
		encoding: "utf8",
	});
	const output = (res.stdout || "") + (res.stderr || "");
	if (res.status !== 0) {
		failed = true;
		console.error(
			output.replace(/(example-\d+\.tsx?)/g, (m) => `${m} [${origin.get(m)}]`),
		);
		console.error(`${count} example(s) compiled in packages/${host}: FAILED`);
	} else {
		console.log(`${count} example(s) compiled in packages/${host}: ok`);
	}
}

if (failed) {
	console.error(`\n${total} example(s) checked: FAILED`);
	process.exit(1);
}
console.log(`\n${total} example(s) checked: ok`);
