/**
 * The playground's bars demo (`apps/playground/src/demos-next/bars.tsx`) in
 * React, with its data and reveal as props. The Solid twin is
 * `packages/solidjs/src/examples/bars.tsx`; the example tests check both
 * produce the same specs.
 */

import type { Readable, Scene } from "@sophistry/core";
import type { Ref } from "react";
import { BarChart } from "../generated/charts.gen.js";
import { Stage } from "../stage.js";

/** Props of {@link BarsExample}. */
export interface BarsExampleProps {
	/** The bar heights. */
	data: readonly number[];
	/** How far the chart is revealed, 0..1 (a test writes it). */
	progress: Readable<number>;
	/** Receives the scene (the stage's `ref`). */
	ref?: Ref<Scene>;
}

/** See the module comment. */
export function BarsExample({ data, progress, ref }: BarsExampleProps) {
	return (
		<Stage units={10} ref={ref}>
			<BarChart
				data={[...data]}
				label={(_, index) => "abcde"[index] ?? ""}
				yRange={[0, 10, 2]}
				width={8}
				height={4}
				center={{ x: -4, y: -2 }}
				progress={progress}
			/>
		</Stage>
	);
}
