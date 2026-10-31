// Gallery visual regression in the pinned Playwright container, so a run on
// any host renders exactly what CI's e2e job (the same image) renders.
//
//   pnpm test:e2e:visual            # build the docs, compare against baselines
//   pnpm test:e2e:visual --native   # the same, lighter, in the host's own arch
//   pnpm test:e2e:update            # build the docs, rewrite every baseline
//   node scripts/e2e-visual.mjs --no-build -g UnitCircle   # extra args go to playwright
//
// Baselines live in e2e/__screenshots__/gallery/<category>/<Name>.png and are
// Linux-only; see CONTRIBUTING.md ("Visual regression"). The image tag follows
// the installed @playwright/test, so its browser build always matches. It runs
// as linux/amd64 (emulated on Apple silicon) because that is what CI runs:
// Chromium's rasteriser is not bit-identical across CPU architectures.
//
// `--native` compares in the image's build for the host's architecture
// (linux/arm64 on Apple silicon) instead: no emulation, so it is lighter.
// arm64 renders have matched the amd64 baselines within the comparison's
// tolerance, so it is a good local check, but not the authority: a change
// that moves a handful of pixels can pass on one architecture and fail on the
// other. CI (amd64) decides, and baselines are only ever written on amd64
// (`--update --native` is refused).
//
// Options:
//   --update     regenerate baselines (`--update-snapshots=all`); with no other
//                playwright arguments the existing baselines are deleted first, so
//                those of removed examples do not linger
//   --native     compare in the host's architecture (see above); not with --update
//   --no-build   skip `pnpm --filter @sophistry/docs build`; docs/dist must then
//                be a capture build (one this script or `pnpm test:e2e` made)
// Environment:
//   E2E_DOCS_DIST  serve this docs build instead of docs/dist (implies --no-build);
//                  build it with PUBLIC_SOPHISTRY_CAPTURE=1, or the gallery has no
//                  capture mode (the production docs leave it out)
//
// Needs Docker (Docker Desktop, OrbStack, colima, ...).
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const update = args.includes("--update");
const native = args.includes("--native");
const external = process.env.E2E_DOCS_DIST
	? resolve(process.env.E2E_DOCS_DIST)
	: null;
const build = !args.includes("--no-build") && !external;
const extra = args.filter(
	(arg) => arg !== "--update" && arg !== "--no-build" && arg !== "--native",
);

if (native && update) {
	console.error(
		"e2e-visual: --native cannot write baselines. They are rendered on linux/amd64,\n" +
			"where CI compares them; run `pnpm test:e2e:update` without --native.",
	);
	process.exit(1);
}

const { version } = JSON.parse(
	readFileSync(
		new URL("../node_modules/@playwright/test/package.json", import.meta.url),
		"utf8",
	),
);
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const arch = native && process.arch === "arm64" ? "arm64" : "amd64";
const platform = `linux/${arch}`;

try {
	execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
		stdio: "ignore",
	});
} catch {
	console.error(
		"e2e-visual: Docker is not running (or not installed). The gallery baselines are\n" +
			"rendered in the Playwright Linux container; start Docker and try again.",
	);
	process.exit(1);
}

/**
 * The image to run for `platform`. amd64 is the tag itself. Another
 * architecture is pinned by its manifest digest: pulling the tag for a second
 * platform re-points the local tag at it (Docker's classic image store keeps
 * one image per tag), and the next amd64 run would download it all again.
 */
function imageForPlatform() {
	if (arch === "amd64") return image;
	let index;
	try {
		index = JSON.parse(
			execFileSync("docker", ["manifest", "inspect", image], {
				encoding: "utf8",
			}),
		);
	} catch {
		console.error(
			`e2e-visual: could not read the manifest of ${image} (offline?).\n` +
				"Run without --native to use the linux/amd64 image.",
		);
		process.exit(1);
	}
	const entry = index.manifests?.find(
		(m) => m.platform?.os === "linux" && m.platform?.architecture === arch,
	);
	if (!entry) {
		console.error(`e2e-visual: ${image} has no ${platform} build.`);
		process.exit(1);
	}
	return `${image.slice(0, image.lastIndexOf(":"))}@${entry.digest}`;
}
const ref = imageForPlatform();

if (build) {
	// Capture mode (docs/src/components/capture.ts) is compiled in only when
	// this is set; the production docs build leaves it out.
	execFileSync("pnpm", ["--filter", "@sophistry/docs", "build"], {
		cwd: root,
		stdio: "inherit",
		env: { ...process.env, PUBLIC_SOPHISTRY_CAPTURE: "1" },
	});
}

if (update && extra.length === 0) {
	rmSync(resolve(root, "e2e/__screenshots__/gallery"), {
		recursive: true,
		force: true,
	});
}

const docker = [
	"run",
	"--rm",
	`--platform=${platform}`,
	"--ipc=host",
	...(process.stdout.isTTY ? ["-t"] : []),
	// Files written to the mounted tree (baselines, test results) stay yours.
	...(typeof process.getuid === "function"
		? ["--user", `${process.getuid()}:${process.getgid()}`, "-e", "HOME=/tmp"]
		: []),
	"-v",
	`${root}:/work`,
	"-w",
	"/work",
	...(external ? ["-v", `${external}:/docs-dist:ro`] : []),
	"-e",
	`E2E_DOCS_DIST=${external ? "/docs-dist" : "/work/docs/dist"}`,
	"-e",
	"E2E_VISUAL=1",
	// Only the static docs server: the Vite ones would need Linux builds of
	// their native dependencies, and the gallery does not use them.
	"-e",
	"E2E_SERVERS=docs",
	ref,
	"node",
	"node_modules/@playwright/test/cli.js",
	"test",
	"--project=gallery",
	"--no-deps",
	...(update ? ["--update-snapshots=all"] : []),
	...extra,
];

console.log(
	native
		? `e2e-visual: ${ref} (${platform}; CI compares on linux/amd64)`
		: `e2e-visual: ${image} (${platform})`,
);
const result = spawnSync("docker", docker, { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
