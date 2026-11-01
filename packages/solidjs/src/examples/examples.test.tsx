/**
 * The cross-binding examples, Solid side: mount the shapes and bars examples
 * under happy-dom, step them to fixed times, and record their spec frames
 * to `packages/react/src/examples/specs/*.json`, which the React twins must
 * reproduce exactly (`packages/react/src/examples/examples.test.tsx`, same
 * props, same times). Both sides compare parsed JSON, so formatting the
 * files is harmless. A change in core's output fails here first; re-record
 * with `RECORD=1 npx vitest run src/examples` (from this package), then run
 * the React side.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@solidjs/web";
import type { Scene } from "@sophistry/core";
import { createClock, track } from "@sophistry/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import barsRecording from "../../../react/src/examples/specs/bars.json" with {
	type: "json",
};
import shapesRecording from "../../../react/src/examples/specs/shapes.json" with {
	type: "json",
};
import type { DomHarness } from "../test/dom.js";
import { installDom, mountPoint } from "../test/dom.js";
import { BarsExample } from "./bars.js";
import { createRecorder } from "./normalize.js";
import { ShapesExample } from "./shapes.js";

/** Where the React side reads the recordings, from this package's root. */
const SPECS = "../react/src/examples/specs";
/** The times the shapes example is recorded at, in seconds. */
const SHAPES_TIMES = [0, 0.75, 1.5, 2.25, 4, 6.5];
/** The reveal values the bars example is recorded at. */
const BARS_PROGRESS = [0, 0.4, 1];

let dom: DomHarness;
beforeEach(() => {
	dom = installDom();
});
afterEach(() => {
	dom.restore();
});

/**
 * Checks `frames` against the recording `name`, or with `RECORD=1` in the
 * environment rewrites the recording instead.
 */
function checkRecording(
	name: string,
	frames: unknown[],
	recording: unknown,
): void {
	const plain = JSON.parse(JSON.stringify(frames));
	if (process.env.RECORD) {
		writeFileSync(
			resolve(SPECS, `${name}.json`),
			`${JSON.stringify(plain, null, "\t")}\n`,
		);
		return;
	}
	expect(plain).toEqual(recording);
}

describe("examples (Solid, recorded for React)", () => {
	it("shapes: a drawn circle and a walking dot", () => {
		const clock = createClock({ reducedMotion: "no-preference" });
		let scene: Scene | undefined;
		render(
			() => (
				<ShapesExample
					clock={clock}
					radius={2}
					caption="unit circle"
					ref={(created) => {
						scene = created;
					}}
				/>
			),
			mountPoint(),
		);
		const recorder = createRecorder(scene as Scene);
		const frames: unknown[] = [];
		let at = 0;
		for (const time of SHAPES_TIMES) {
			clock.advance(time - at);
			at = time;
			frames.push(recorder.frame());
		}
		// The script ran: the drawn circle and the dot changed.
		expect(frames[0]).not.toEqual(frames[2]);
		expect(frames[2]).not.toEqual(frames[3]);
		checkRecording("shapes", frames, shapesRecording);
	});

	it("bars: a bar chart at three reveal values", () => {
		const progress = track(0);
		let scene: Scene | undefined;
		render(
			() => (
				<BarsExample
					data={[3, 7, 4, 9, 6]}
					progress={progress}
					ref={(created) => {
						scene = created;
					}}
				/>
			),
			mountPoint(),
		);
		const recorder = createRecorder(scene as Scene);
		const frames: unknown[] = [];
		for (const value of BARS_PROGRESS) {
			progress.set(value);
			frames.push(recorder.frame());
		}
		expect(frames[0]).not.toEqual(frames[2]);
		checkRecording("bars", frames, barsRecording);
	});
});
