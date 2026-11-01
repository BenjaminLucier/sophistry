/**
 * `<SplitScreen>`, `<PictureInPicture>` and `<QuadView>`: the camera
 * layouts, as compositions of `<Camera>`s with their viewports arranged by
 * core's `splitViewports`, `pictureInPictureViewports` and `quadViewports`.
 * Each renders its cameras in order, so they paint in JSX order like any
 * other `<Camera>` (the later pane over the earlier one).
 */

import type { JSX } from "@solidjs/web";
import type { PipCorner } from "@sophistry/core";
import {
	pictureInPictureViewports,
	quadViewports,
	splitViewports,
} from "@sophistry/core";
import { createMemo } from "solid-js";
import type { CameraProps } from "./stage.js";
import { Camera } from "./stage.js";

/**
 * A {@link CameraProps} minus its `viewport`: one pane of a layout
 * ({@link SplitScreen}, {@link PictureInPicture}, {@link QuadView}), which
 * arranges the viewports itself. `units`, `center`, `border` and
 * `background` may be `Readable`s, which bind.
 *
 * @category Stage & cameras
 */
export type CameraPaneProps = Omit<CameraProps, "viewport">;

/**
 * Props for {@link SplitScreen}. Every prop is reactive.
 *
 * @category Stage & cameras
 */
export interface SplitScreenProps {
	/** The two cameras, first pane (left or top) first. */
	panes: [CameraPaneProps, CameraPaneProps];
	/**
	 * `"horizontal"` puts the panes left and right (the divider is vertical),
	 * `"vertical"` puts them top and bottom. The name is manim-web's.
	 *
	 * @default "horizontal"
	 */
	split?: "horizontal" | "vertical";
	/**
	 * The first pane's share of the canvas, 0..1 (clamped).
	 *
	 * @default 0.5
	 */
	ratio?: number;
}

/**
 * Two cameras sharing the canvas, side by side or stacked: manim-web's
 * `SplitScreenCamera`. Place it inside a `<MultiStage>` (or `<Stage>`).
 *
 * @example
 * ```tsx
 * import { Circle, MultiStage, SplitScreen } from "@sophistry/solidjs";
 *
 * export const Zoomed = () => (
 * 	<MultiStage units={10}>
 * 		<Circle radius={2} />
 * 		<SplitScreen panes={[{}, { units: 4, center: { x: 2, y: 0 } }]} ratio={0.6} />
 * 	</MultiStage>
 * );
 * ```
 *
 * @param props - See {@link SplitScreenProps}.
 * @returns The two cameras' anchors (empty nodes, no DOM).
 * @category Stage & cameras
 */
export function SplitScreen(props: SplitScreenProps): JSX.Element {
	const viewports = createMemo(() =>
		splitViewports(props.split ?? "horizontal", props.ratio ?? 0.5),
	);
	return (
		<>
			<Camera {...props.panes[0]} viewport={viewports()[0]} />
			<Camera {...props.panes[1]} viewport={viewports()[1]} />
		</>
	);
}

/**
 * Props for {@link PictureInPicture}. Every prop is reactive.
 *
 * @category Stage & cameras
 */
export interface PictureInPictureProps {
	/** The full-canvas camera. */
	main: CameraPaneProps;
	/** The corner camera, painted over `main`. */
	inset: CameraPaneProps;
	/**
	 * Which corner holds the inset.
	 *
	 * @default "top-right"
	 */
	corner?: PipCorner;
	/**
	 * The inset's share of each canvas dimension, 0..1.
	 *
	 * @default 0.3
	 */
	size?: number;
	/**
	 * Gap between the inset and the canvas edges, as a fraction of each
	 * canvas dimension.
	 *
	 * @default 0.02
	 */
	margin?: number;
}

/**
 * A full-canvas view with a magnified inset pinned to a corner: manim-web's
 * `setupPictureInPicture`. Give the inset a smaller `units` and a `center`
 * bound to a moving point's track, and it becomes a moving magnifier with no
 * Solid work per frame.
 *
 * The inset paints after (over) the main view and has an opaque background
 * by default; pointer gestures that start inside it belong to the inset.
 *
 * @example
 * ```tsx
 * import { trackPoint } from "@sophistry/core";
 * import { Dot, MultiStage, PictureInPicture } from "@sophistry/solidjs";
 *
 * export function Magnifier() {
 * 	const dot = trackPoint(2, 0);
 * 	return (
 * 		<MultiStage units={10}>
 * 			<Dot center={dot} />
 * 			<PictureInPicture main={{}} inset={{ units: 4, center: dot }} corner="bottom-left" />
 * 		</MultiStage>
 * 	);
 * }
 * ```
 *
 * @param props - See {@link PictureInPictureProps}.
 * @returns The two cameras' anchors (empty nodes, no DOM).
 * @category Stage & cameras
 */
export function PictureInPicture(props: PictureInPictureProps): JSX.Element {
	const viewports = createMemo(() =>
		pictureInPictureViewports(
			props.corner ?? "top-right",
			props.size ?? 0.3,
			props.margin ?? 0.02,
		),
	);
	return (
		<>
			<Camera {...props.main} viewport={viewports()[0]} />
			<Camera {...props.inset} viewport={viewports()[1]} />
		</>
	);
}

/**
 * Props for {@link QuadView}. Reactive.
 *
 * @category Stage & cameras
 */
export interface QuadViewProps {
	/**
	 * Four cameras in reading order: top-left, top-right, bottom-left,
	 * bottom-right.
	 */
	panes: [CameraPaneProps, CameraPaneProps, CameraPaneProps, CameraPaneProps];
}

/**
 * Four panes in a 2×2 grid, in reading order: manim-web's `setupQuadView`.
 * Conventionally the first is the overview and the rest are close-ups, but
 * the grid does not enforce that.
 *
 * @param props - See {@link QuadViewProps}.
 * @returns The four cameras' anchors (empty nodes, no DOM).
 * @category Stage & cameras
 */
export function QuadView(props: QuadViewProps): JSX.Element {
	const viewports = quadViewports();
	return (
		<>
			<Camera {...props.panes[0]} viewport={viewports[0]} />
			<Camera {...props.panes[1]} viewport={viewports[1]} />
			<Camera {...props.panes[2]} viewport={viewports[2]} />
			<Camera {...props.panes[3]} viewport={viewports[3]} />
		</>
	);
}
