/**
 * `<Camera>`: one view of the enclosing stage's scene, as a component over
 * `scene.addCamera(...)`.
 */

import type { CameraOptions, Camera as SceneCamera } from "@sophistry/core";
import type { GroupNode } from "@sophistry/core/internal";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Group } from "./generated/core.gen";
import { useScene } from "./hooks";

/**
 * Props for {@link Camera}: the options of `scene.addCamera(...)` minus
 * `anchor` (the component is its own anchor). `units`, `center`, `border`
 * and `background` take a `Readable` to bind (a camera following a moving
 * point, or a border following the theme, re-renders nothing).
 *
 * @category Stage & cameras
 */
export type CameraProps = Omit<CameraOptions, "anchor">;

/**
 * One view of the scene: a rectangle of the canvas (`viewport`) and what it
 * looks at (`units`, `center`, `yUp`), with an optional `border` and
 * `background`. Anything omitted falls back to the stage's framing and
 * background, so `<Camera viewport={...} />` alone is a window onto the scene
 * as framed. Draws nothing; place it inside a `<Stage>` (or `<MultiStage>`),
 * directly or in a plain `<Group>`. A stage with at least one camera paints
 * only its cameras.
 *
 * Cameras paint in JSX order, later over earlier,: the
 * component renders an empty `<Group>`, the camera's `anchor`, which sits in
 * the scene tree where the `<Camera>` is, so a conditional camera mounted
 * later still paints in its place, and reordering cameras reorders the
 * paint. (A layout composite would count the anchor as a child.) Props are
 * applied on every render (`camera.update`); unmounting removes the camera.
 *
 * Layouts: `splitViewports`, `pictureInPictureViewports` and `quadViewports`
 * from `@sophistry/core` give the viewports for side-by-side, inset and
 * 2x2 arrangements.
 *
 * @example
 * ```tsx
 * import { splitViewports } from "@sophistry/core";
 * import { Camera, Circle, MultiStage } from "@sophistry/react";
 *
 * const [left, right] = splitViewports("horizontal", 0.5);
 *
 * <MultiStage units={8}>
 * 	<Circle radius={1} />
 * 	<Camera viewport={left} />
 * 	<Camera viewport={right} units={3} border="white" />
 * </MultiStage>;
 * ```
 *
 * @param props - See {@link CameraProps}.
 * @returns Nothing.
 * @throws Outside a `<Stage>`.
 * @category Stage & cameras
 */
export function Camera(props: CameraProps): ReactNode {
	const scene = useScene();
	const camera = useRef<SceneCamera | null>(null);
	const anchor = useRef<GroupNode>(null);
	const latest = useRef(props);
	latest.current = props;

	// The anchor's ref is set before this layout effect runs (children commit first).
	useLayoutEffect(() => {
		const made = scene.addCamera({
			...latest.current,
			anchor: anchor.current,
		});
		camera.current = made;
		return () => {
			made.dispose();
			if (camera.current === made) camera.current = null;
		};
	}, [scene]);

	const { units, center, yUp, viewport, border, borderWidth, background } =
		props;
	useLayoutEffect(() => {
		camera.current?.update({
			units,
			center,
			yUp,
			viewport,
			border,
			borderWidth,
			background,
		});
	}, [units, center, yUp, viewport, border, borderWidth, background]);

	return <Group ref={anchor} />;
}
