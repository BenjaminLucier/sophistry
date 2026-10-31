import { fileURLToPath } from "node:url";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

// Serves the fixture scenes against the workspace library source (the package
// ships TypeScript that only a bundler resolves).
export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	server: { port: 5201, strictPort: true },
	preview: { port: 5201, strictPort: true },
	plugins: [solid({ extensions: [".jsx", ".tsx"] })],
	resolve: { dedupe: ["solid-js", "@solidjs/web"] },
});
