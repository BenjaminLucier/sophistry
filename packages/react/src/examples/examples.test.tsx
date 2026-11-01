/**
 * The cross-binding examples, React side: the shapes and bars examples,
 * mounted under happy-dom with the same props and stepped to the same times
 * as their Solid twins, must produce exactly the spec frames the Solid side
 * recorded in `specs/*.json` (`packages/solidjs/src/examples/examples.test.tsx`).
 */

import type { Scene } from "@sophistry/core";
import { createClock, track } from "@sophistry/core";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DomHarness, installDom } from "../test-dom.js";
import { BarsExample } from "./bars.js";
import { createRecorder } from "./normalize.js";
import { ShapesExample } from "./shapes.js";
import barsRecording from "./specs/bars.json" with { type: "json" };
import shapesRecording from "./specs/shapes.json" with { type: "json" };

/** The times the shapes example is recorded at, in seconds (as on the Solid side). */
const SHAPES_TIMES = [0, 0.75, 1.5, 2.25, 4, 6.5];
/** The reveal values the bars example is recorded at (as on the Solid side). */
const BARS_PROGRESS = [0, 0.4, 1];

let dom: DomHarness;
beforeEach(() => {
	dom = installDom();
});
afterEach(() => {
	cleanup();
	dom.restore();
});

/** Round-trips through JSON, as the recording did (drops `undefined`s). */
const asRecorded = (frames: unknown[]): unknown =>
	JSON.parse(JSON.stringify(frames));

describe("examples (React, against the Solid recordings)", () => {
	it("shapes: the same specs as the Solid example at every time", () => {
		const clock = createClock({ reducedMotion: "no-preference" });
		const ref = createRef<Scene>();
		render(
			<ShapesExample
				clock={clock}
				radius={2}
				caption="unit circle"
				ref={ref}
			/>,
		);
		const recorder = createRecorder(ref.current as Scene);
		const frames: unknown[] = [];
		let at = 0;
		for (const time of SHAPES_TIMES) {
			act(() => clock.advance(time - at));
			at = time;
			frames.push(recorder.frame());
		}
		expect(asRecorded(frames)).toEqual(shapesRecording);
	});

	it("bars: the same specs as the Solid example at every reveal", () => {
		const progress = track(0);
		const ref = createRef<Scene>();
		render(
			<BarsExample data={[3, 7, 4, 9, 6]} progress={progress} ref={ref} />,
		);
		const recorder = createRecorder(ref.current as Scene);
		const frames: unknown[] = [];
		for (const value of BARS_PROGRESS) {
			progress.set(value);
			frames.push(recorder.frame());
		}
		expect(asRecorded(frames)).toEqual(barsRecording);
	});
});
