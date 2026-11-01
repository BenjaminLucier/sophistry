/**
 * The playground's bars demo (`apps/playground/src/demos-next/bars.tsx`)
 * with its data and reveal as props, for the cross-binding example tests.
 * The React twin is `packages/react/src/examples/bars.tsx`.
 */

import type { Readable, Scene } from "@sophistry/core";
import { BarChart } from "../generated/charts.gen.js";
import { Stage } from "../stage.js";

/** Props of {@link BarsExample}. */
export interface BarsExampleProps {
	/** The bar heights. */
	data: readonly number[];
	/** How far the chart is revealed, 0..1 (a test writes it). */
	progress: Readable<number>;
	/** Receives the scene (the stage's `ref`). */
	ref?: (scene: Scene) => void;
}

/** See the module comment. */
export function BarsExample(props: BarsExampleProps) {
	return (
		<Stage units={10} ref={props.ref}>
			<BarChart
				data={[...props.data]}
				label={(_, index) => "abcde"[index] ?? ""}
				yRange={[0, 10, 2]}
				width={8}
				height={4}
				center={{ x: -4, y: -2 }}
				progress={props.progress}
			/>
		</Stage>
	);
}
