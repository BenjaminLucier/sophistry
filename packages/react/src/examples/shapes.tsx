/**
 * The playground's shapes demo (`apps/playground/src/demos-next/shapes.tsx`)
 * in React, with its numbers as props: a circle drawn on, a dot walking
 * round it, a caption. The Solid twin is
 * `packages/solidjs/src/examples/shapes.tsx`; the example tests check both
 * produce the same specs.
 */

import type { Clock, Scene } from "@sophistry/core";
import { draw, moveTo, sequence } from "@sophistry/core";
import { type Ref, useEffect } from "react";
import { Circle, Dot, Label } from "../generated/core.gen";
import { usePlayer, useTrack } from "../hooks";
import { Stage } from "../stage";

/** Props of {@link ShapesExample}. */
export interface ShapesExampleProps {
	/** The clock the script runs on (a test steps it). */
	clock: Clock;
	/** The circle's radius, which the dot walks round. */
	radius: number;
	/** The caption under the circle. */
	caption: string;
	/** Receives the scene (the stage's `ref`). */
	ref?: Ref<Scene>;
}

/** The script: draw the circle (1.5 s), then four quarter turns (1 s each). */
function Script({ radius }: { radius: number }) {
	const drawn = useTrack(0);
	const dot = useTrack({ x: radius, y: 0 });
	const player = usePlayer();
	useEffect(() => {
		void player.play(
			sequence(
				draw(drawn, { duration: 1.5 }),
				moveTo(dot, { x: 0, y: radius }, { duration: 1 }),
				moveTo(dot, { x: -radius, y: 0 }, { duration: 1 }),
				moveTo(dot, { x: 0, y: -radius }, { duration: 1 }),
				moveTo(dot, { x: radius, y: 0 }, { duration: 1 }),
			),
		);
	}, [player, drawn, dot, radius]);
	return (
		<>
			<Circle center={{ x: 0, y: 0 }} radius={radius} progress={drawn} />
			<Dot center={dot} />
		</>
	);
}

/** See the module comment. */
export function ShapesExample({
	clock,
	radius,
	caption,
	ref,
}: ShapesExampleProps) {
	return (
		<Stage units={8} clock={clock} ref={ref}>
			<Script radius={radius} />
			<Label text={caption} y={-3.2} />
		</Stage>
	);
}
