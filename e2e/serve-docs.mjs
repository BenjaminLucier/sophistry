// Minimal static server for docs/dist. `astro preview` daemonises itself in
// Astro 7, which Playwright's webServer cannot own, so serve the build directly.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root =
	process.env.E2E_DOCS_DIST ??
	fileURLToPath(new URL("../docs/dist", import.meta.url));
const port = Number(process.argv[2] ?? 4322);
const types = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
	".woff2": "font/woff2",
	".png": "image/png",
	".xml": "application/xml",
};

createServer((req, res) => {
	const path = normalize(
		decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname),
	);
	let file = join(root, path);
	if (!file.startsWith(root)) return void res.writeHead(403).end();
	if (existsSync(file) && statSync(file).isDirectory())
		file = join(file, "index.html");
	if (!existsSync(file)) {
		res.writeHead(404, { "content-type": "text/plain" }).end("not found");
		return;
	}
	res.writeHead(200, {
		"content-type": types[extname(file)] ?? "application/octet-stream",
	});
	createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () =>
	console.log(`docs/dist on http://127.0.0.1:${port}`),
);
