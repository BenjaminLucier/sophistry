import { ExampleIsland } from "./ExampleIsland";

/**
 * Dev/QA helper: renders one gallery example full-bleed, chosen by
 * `?name=<category>/<Name>` (and `&mode=light|dark`), so each example can be
 * screenshotted on its own. Not linked from anywhere.
 */
export default function PreviewByQuery() {
	const params = new URLSearchParams(window.location.search);
	const mode = params.get("mode") === "light" ? "light" : "dark";
	document.documentElement.dataset.theme = mode;
	document.documentElement.dataset.mode = mode;
	return <ExampleIsland name={params.get("name") ?? ""} />;
}
