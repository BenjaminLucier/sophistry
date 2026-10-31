/**
 * `@sophistry/solidjs/3d`: the components of `@sophistry/3d`,
 * generated from its definitions, plus {@link useOrbitControls3D}.
 *
 * @module @sophistry/solidjs/3d
 */

import type { JSX } from "@solidjs/web";
import {
	type OrbitControls3DController,
	type OrbitControls3DSceneOptions,
	orbitControls3D,
} from "@sophistry/3d";
import { onCleanup } from "solid-js";
import { useScene } from "../context";

export * from "../generated/3d.gen";

/**
 * Attaches `orbitControls3D` to the enclosing `<Stage>`'s scene for the
 * component's lifetime: drag to orbit, wheel to dolly. Bind the same `eye`
 * track to `<Camera3D eye={eye}>`. Options are read once; change them later
 * with the returned controller's `update`.
 *
 * @example
 * ```tsx
 * import { Stage, useTrack } from "@sophistry/solidjs";
 * import { Camera3D, Cube3D, useOrbitControls3D } from "@sophistry/solidjs/3d";
 *
 * function Orbiting() {
 * 	const eye = useTrack({ x: 6, y: 4, z: 8 });
 * 	useOrbitControls3D({ eye });
 * 	return <Camera3D eye={eye}><Cube3D /></Camera3D>;
 * }
 *
 * export const Figure = () => <Stage><Orbiting /></Stage>;
 * ```
 *
 * @param options - See `OrbitControls3DSceneOptions`.
 * @returns The controller (`update`, `reset`, `dispose`).
 * @category Controls
 */
export function useOrbitControls3D(
	options: OrbitControls3DSceneOptions,
): OrbitControls3DController {
	const controller = orbitControls3D(useScene(), options);
	onCleanup(() => controller.dispose());
	return controller;
}

/**
 * Props for {@link OrbitControls3D}: `OrbitControls3DSceneOptions`, plus a
 * `ref` that receives the controller (for a reset button).
 *
 * @category Controls
 */
export interface OrbitControls3DProps extends OrbitControls3DSceneOptions {
	/** Called once with the controller. */
	ref?: (controller: OrbitControls3DController) => void;
}

/**
 * {@link useOrbitControls3D} as a component, like `<PanZoom>`: place it
 * inside the `<Stage>` and give it the `eye` track the `<Camera3D>` binds.
 * Renders nothing; the controls detach when it is removed.
 *
 * @example
 * ```tsx
 * import { Stage, useTrack } from "@sophistry/solidjs";
 * import { Camera3D, Cube3D, OrbitControls3D } from "@sophistry/solidjs/3d";
 *
 * function Orbiting() {
 * 	const eye = useTrack({ x: 6, y: 4, z: 8 });
 * 	return (
 * 		<>
 * 			<OrbitControls3D eye={eye} />
 * 			<Camera3D eye={eye}><Cube3D /></Camera3D>
 * 		</>
 * 	);
 * }
 *
 * export const Figure = () => <Stage><Orbiting /></Stage>;
 * ```
 *
 * @param props - See {@link OrbitControls3DProps}; read as for {@link useOrbitControls3D}.
 * @returns Nothing.
 * @throws When rendered outside a `<Stage>`.
 * @category Controls
 */
export function OrbitControls3D(props: OrbitControls3DProps): JSX.Element {
	const controller = useOrbitControls3D(props);
	props.ref?.(controller);
	return null;
}
