/**
 * A chart's categorical axis: the line the bands stand on, and a name under
 * (or beside) each band. Internal to the frame (and a group's guides); not
 * exported from the package entry.
 */

import type {
	AxisOptions,
	CompositeContext,
	CoordinateSystem,
	SceneNode,
} from "@sophistry/core";
import {
	DOWN,
	defineComposite,
	Invalidate,
	LEFT,
	label,
	line,
	measuresText,
	phaseProgress,
	RIGHT,
	UP,
} from "@sophistry/core";
import type { BandKey, BandScale, Point } from "@sophistry/core/geometry";
import {
	anchoredLabelProps,
	clamp01,
	stablePoint,
} from "@sophistry/core/internal";
import type { MergedAxisOptions } from "./fit";
import {
	DEFAULT_CATEGORY_FONT_SIZE,
	DEFAULT_CATEGORY_NUMBER_GAP,
} from "./layout";

/**
 * Props for {@link bandAxis}.
 *
 * @category Extending
 */
export interface BandAxisProps {
	band: BandScale;
	/** A category name's opacity, 0..1 (a keyed transition fading it in or out). @default 1 */
	weight?: (key: BandKey) => number;
	options: MergedAxisOptions;
	/** An outline around each name; see `LabelProps.halo`. */
	halo?: AxisOptions["numberHalo"];
	coords: CoordinateSystem;
	along: "x" | "y";
	/** The other axis's value the line sits at, in data units. */
	at: number;
	/** Where the line sits across the plot in scene units, in place of `at` (mid-swap). */
	across?: number;
	/** On the top or right edge: names face outward (up, right). */
	far?: boolean;
	/** The whole axis's opacity, 0..1 (a kind swap's cross-fade). @default 1 */
	opacity?: number;
	progress: number;
	zIndex?: number;
	visible?: boolean;
}

/** The axis's line, kept between updates. */
const lines = new WeakMap<object, { line: SceneNode | null }>();

function build(ctx: CompositeContext<BandAxisProps>): SceneNode[] {
	measuresText(ctx);
	let kept = lines.get(ctx.node);
	if (!kept) {
		kept = { line: null };
		lines.set(ctx.node, kept);
	}
	const props = ctx.props;
	const theme = ctx.theme;
	const fontFamily = theme.defaults.fontFamily;
	const { band, coords, options } = props;
	const point = (along: number, across: number): Point => {
		const at =
			props.along === "x"
				? coords.coordsToPoint(along, across)
				: coords.coordsToPoint(across, along);
		const moved = props.across;
		if (moved === undefined) return at;
		return props.along === "x" ? { x: at.x, y: moved } : { x: moved, y: at.y };
	};
	// The axis's range as drawn: the band's, or a zoomed window onto it.
	const range = props.along === "x" ? coords.xRange() : coords.yRange();
	const [a, b] = range;
	const [r0, r1] = band.range;
	// Not zoomed (the window holds the whole band): every name is whole.
	const whole =
		Math.min(a, b) <= Math.min(r0, r1) + 1e-9 &&
		Math.max(a, b) >= Math.max(r0, r1) - 1e-9;
	/**
	 * A name's strength by where its band sits in the window: whole within
	 * half a slot of an edge, fading out past it, gone outside.
	 */
	const inWindow = (key: BandKey) => {
		if (whole) return 1;
		const at = band.center(key) ?? 0;
		const room = Math.min(at - Math.min(a, b), Math.max(a, b) - at);
		return clamp01(room / 0.5);
	};
	const color =
		typeof options.stroke === "string"
			? options.stroke
			: theme.palette.foreground;
	/**
	 * The reveal in a number line's phases, so both axes of a chart keep
	 * step: the line over the first third, and the names fading in over the
	 * last, as the numbers do, so no name shows before the line reaches it.
	 */
	const phase = (index: number) => phaseProgress(props.progress, index, 3);
	const named = phase(2);
	const nodes: SceneNode[] = [];

	if (options.line !== false) {
		const lineProps = {
			from: stablePoint(
				kept.line?.get("from" as never),
				point(range[0], props.at),
			),
			to: stablePoint(kept.line?.get("to" as never), point(range[1], props.at)),
			stroke: color,
			strokeWidth: options.strokeWidth,
			opacity:
				props.opacity !== undefined && props.opacity < 1
					? props.opacity
					: undefined,
			zIndex: props.zIndex,
			visible: props.visible,
			progress: phase(0),
		};
		if (kept.line) kept.line.update(lineProps as never);
		else kept.line = line.create(lineProps as never);
		nodes.push(kept.line);
	} else if (kept.line) {
		kept.line.dispose();
		kept.line = null;
	}

	if (options.numbers !== false) {
		const direction =
			options.numberDirection ??
			(props.along === "x"
				? props.far
					? UP
					: DOWN
				: props.far
					? RIGHT
					: LEFT);
		/** The names in play: in the data, in the window, the frame begun, and with text. */
		const shown: { key: BandKey; text: string; weight: number }[] = [];
		band.domain.forEach((key, index) => {
			const weight =
				(props.weight?.(key) ?? 1) *
				inWindow(key) *
				(props.opacity ?? 1) *
				(props.progress > 0 ? 1 : 0);
			const text = options.categoryLabel?.(key, index) ?? String(key);
			if (weight > 0 && text) shown.push({ key, text, weight });
		});
		const propsFor = (
			item: (typeof shown)[number],
			previous: SceneNode | undefined,
		) => {
			// Faded in whole after the line, rather than written on, as the numbers are.
			const strength = item.weight * named;
			return anchoredLabelProps(
				{
					text: item.text,
					at: point(band.center(item.key) ?? 0, props.at),
					direction,
					gap: options.numberGap ?? DEFAULT_CATEGORY_NUMBER_GAP,
					fontSize: options.numberFontSize ?? DEFAULT_CATEGORY_FONT_SIZE,
					color: theme.palette.muted,
					opacity: strength < 1 ? strength : undefined,
					zIndex: props.zIndex,
					halo: props.halo,
				},
				fontFamily,
				previous?.get("place" as never),
			);
		};
		const names = ctx.list("names", shown, {
			key: (item) => item.key,
			create: (item) => label.create(propsFor(item, undefined) as never),
			update: (node, item) => node.update(propsFor(item, node) as never),
		});
		for (const node of names) nodes.push(node);
	} else {
		ctx.list("names", [] as { key: BandKey }[], {
			key: (item) => item.key,
			create: () => label.create({ text: "" } as never),
		});
	}
	return nodes;
}

/**
 * A categorical axis: the line the bands stand on, and a name under (or
 * beside) each band, faded by `weight` and by where the band sits in a
 * zoomed window.
 *
 * @category Extending
 */
export const bandAxis = defineComposite<BandAxisProps>({
	name: "BandAxis",
	props: {
		band: { invalidates: Invalidate.UPDATE },
		weight: { invalidates: Invalidate.UPDATE },
		options: { invalidates: Invalidate.UPDATE },
		halo: { invalidates: Invalidate.UPDATE },
		coords: { invalidates: Invalidate.UPDATE },
		along: { default: "x", invalidates: Invalidate.UPDATE },
		at: { default: 0, invalidates: Invalidate.UPDATE },
		across: { invalidates: Invalidate.UPDATE },
		far: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: build,
	update: (_changed, ctx) => build(ctx),
});
