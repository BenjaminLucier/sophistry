/**
 * `@sophistry/react/3d`: the `@sophistry/3d` definitions as
 * components, generated from its definitions, plus
 * {@link useOrbitControls3D}.
 *
 * @module @sophistry/react/3d
 */

import {
	type OrbitControls3DController,
	type OrbitControls3DSceneOptions,
	orbitControls3D,
} from "@sophistry/3d";
import {
	type ReactNode,
	type Ref,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { useScene } from "../hooks.js";

export * from "../generated/3d.gen.js";

/**
 * Attaches `orbitControls3D` to the enclosing `<Stage>`'s scene while the
 * component is mounted: drag to orbit, wheel to dolly. Bind the same `eye`
 * track to `<Camera3D eye={eye}>`. Options are read when the controls
 * attach; change them later with the returned controller's `update`.
 *
 * @example
 * ```tsx
 * import { Stage, useTrack } from "@sophistry/react";
 * import { Camera3D, Cube3D, useOrbitControls3D } from "@sophistry/react/3d";
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
 * @returns The controller once attached (null during the first render).
 * @category Controls
 */
export function useOrbitControls3D(
	options: OrbitControls3DSceneOptions,
): OrbitControls3DController | null {
	const scene = useScene();
	const latest = useRef(options);
	latest.current = options;
	const [controller, setController] =
		useState<OrbitControls3DController | null>(null);
	useEffect(() => {
		const attached = orbitControls3D(scene, latest.current);
		setController(attached);
		return () => {
			attached.dispose();
			setController(null);
		};
	}, [scene]);
	return controller;
}

/**
 * Props for {@link OrbitControls3D}: `OrbitControls3DSceneOptions`, plus a
 * `ref` that receives the controller (for a reset button).
 *
 * @category Controls
 */
export interface OrbitControls3DProps extends OrbitControls3DSceneOptions {
	/** The controller while attached, null otherwise. */
	ref?: Ref<OrbitControls3DController | null>;
}

/**
 * {@link useOrbitControls3D} as a component, like `<PanZoom>`: place it
 * inside the `<Stage>` and give it the `eye` track the `<Camera3D>` binds.
 * Renders nothing; the controls detach when it unmounts.
 *
 * @example
 * ```tsx
 * import { Stage, useTrack } from "@sophistry/react";
 * import { Camera3D, Cube3D, OrbitControls3D } from "@sophistry/react/3d";
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
 * @throws Outside a `<Stage>`.
 * @category Controls
 */
export function OrbitControls3D(props: OrbitControls3DProps): ReactNode {
	const { ref, ...options } = props;
	const controller = useOrbitControls3D(options);
	useImperativeHandle<
		OrbitControls3DController | null,
		OrbitControls3DController | null
	>(ref, () => controller, [controller]);
	return null;
}
