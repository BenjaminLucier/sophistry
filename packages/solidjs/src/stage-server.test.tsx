/**
 * `<Stage>` under server rendering: no scene, canvas or children, just the
 * empty box. Solid's real server renderer needs the JSX compiled in SSR mode
 * (a second plugin configuration), so this test runs the browser build with
 * `isServer` forced on instead; the check is that the component takes the
 * server branch and never builds a scene.
 */

import { render } from "@solidjs/web";
import type { Scene } from "@sophistry/core";
import { describe, expect, it, vi } from "vitest";
import { Circle } from "./generated/core.gen";
import { Stage } from "./stage";
import { installDom, mountPoint } from "./test/dom";

vi.mock("@solidjs/web", async (importOriginal) => ({
	...(await importOriginal<typeof import("@solidjs/web")>()),
	isServer: true,
}));

describe("<Stage> on the server", () => {
	it("renders the empty box without creating a scene", () => {
		const dom = installDom();
		const create = vi.fn();
		const host = mountPoint();
		let created: Scene | undefined;
		render(
			() => (
				<Stage
					class="figure"
					ref={(scene) => {
						created = scene;
						create();
					}}
				>
					<Circle radius={1} />
				</Stage>
			),
			host,
		);
		const box = host.querySelector("div.figure");
		expect(box).not.toBeNull();
		expect(box?.querySelector("canvas")).toBeNull();
		expect(created).toBeUndefined();
		expect(create).not.toHaveBeenCalled();
		dom.restore();
	});
});
