import type { OrbitControls3DSceneOptions } from "@sophistry/3d";
import { track } from "@sophistry/core";
import { Stage } from "@sophistry/solidjs";
import {
	Axes3D,
	Camera3D,
	Cube3D,
	Sphere3D,
	useOrbitControls3D,
} from "@sophistry/solidjs/3d";

/**
 * Drag to orbit, wheel to dolly. The `useOrbitControls3D` hook is called in a component inside `<Stage>` (it attaches to the scene,
 * not to the camera); the `eye` track is bound to `<Camera3D eye>` directly.
 */
export function OrbitDemo() {
	const eye = track({ x: 6, y: 4, z: 8 });

	return (
		<Stage units={10}>
			<OrbitControls eye={eye} />
			<Camera3D eye={eye}>
				<Axes3D length={3} />
				<Cube3D center={{ x: -1.5, y: 0.5, z: 0 }} size={1} />
				<Sphere3D center={{ x: 1.5, y: 0.7, z: 0 }} radius={0.8} />
			</Camera3D>
		</Stage>
	);
}

/**
 * Attaches orbit controls to the enclosing `<Stage>`'s scene and renders
 * nothing: the hook needs the Stage's context, which `OrbitDemo`'s own body
 * is outside of.
 */
function OrbitControls(props: OrbitControls3DSceneOptions) {
	useOrbitControls3D(props);
	return null;
}
