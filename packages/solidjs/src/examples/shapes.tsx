/**
 * The playground's shapes demo (`apps/playground/src/demos-next/shapes.tsx`)
 * with its numbers as props, for the cross-binding example tests: a circle
 * drawn on, a dot walking round it, a caption. The React twin is
 * `packages/react/src/examples/shapes.tsx`.
 */

import type { Clock, Scene } from "@sophistry/core";
import { draw, moveTo, sequence, track, trackPoint } from "@sophistry/core";
import { onSettled } from "solid-js";
import { Circle, Dot, Label } from "../generated/core.gen.js";
import { usePlayer } from "../hooks.js";
import { Stage } from "../stage.js";

/** Props of {@link ShapesExample}. */
export interface ShapesExampleProps {
	/** The clock the script runs on (a test steps it). */
	clock: Clock;
	/** The circle's radius, which the dot walks round. */
	radius: number;
	/** The caption under the circle. */
	caption: string;
	/** Receives the scene (the stage's `ref`). */
	ref?: (scene: Scene) => void;
}

/** The script: draw the circle (1.5 s), then four quarter turns (1 s each). */
function Script(props: { radius: number }) {
	const drawn = track(0);
	const dot = trackPoint(props.radius, 0);
	const player = usePlayer();
	const r = props.radius;
	onSettled(() => {
		void player.play(
			sequence(
				draw(drawn, { duration: 1.5 }),
				moveTo(dot, { x: 0, y: r }, { duration: 1 }),
				moveTo(dot, { x: -r, y: 0 }, { duration: 1 }),
				moveTo(dot, { x: 0, y: -r }, { duration: 1 }),
				moveTo(dot, { x: r, y: 0 }, { duration: 1 }),
			),
		);
	});
	return (
		<>
			<Circle center={{ x: 0, y: 0 }} radius={props.radius} progress={drawn} />
			<Dot center={dot} />
		</>
	);
}

/** See the module comment. */
export function ShapesExample(props: ShapesExampleProps) {
	return (
		<Stage units={8} clock={props.clock} ref={props.ref}>
			<Script radius={props.radius} />
			<Label text={props.caption} y={-3.2} />
		</Stage>
	);
}
