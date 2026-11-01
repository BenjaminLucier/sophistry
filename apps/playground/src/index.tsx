import { pageRoutes } from "virtual:file-routes";
import { createRouter } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { render } from "@solidjs/web";
import { installColorMode } from "@sophistry/core/themes";
import { attribution } from "solid-js/attribution";
import "katex/dist/katex.css";
import { App } from "./App";
import "./index.css";

// Solid's attribution engine (relay-tear, hot-scope, unstable-memo and width
// diagnostics) is opt-in and costs a little per update. `?attribution` turns it
// on in the dev server; `e2e/tests/playground.spec.ts` visits every route that way.
if (
	import.meta.env.DEV &&
	new URLSearchParams(location.search).has("attribution")
)
	attribution.enable();

installColorMode();

const Router = createRouter({ routes: fileRoutes(pageRoutes) });

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

render(() => <Router>{(props) => <App>{props.children}</App>}</Router>, root);
