/**
 * Wind barbs over a vector-field lattice: a fixed-length shaft with ticks for magnitude. Shares
 * its sampling and colour ramp with core's `vectorField` (`createFieldEngine`). Magnitude is
 * read in data units; direction follows the mapped vector, so flipped or log axes turn barbs as
 * they bend arrows.
 *
 * One shape node per colour band (at most `bands`, 10 by default), as
 * `vectorField` does: a band's shafts are strokes and its pennants are filled
 * (`ShapeGeometry.fillFrom`), which a path batch item cannot express.
 */

import type {
	CompositeContext,
	FieldEngine,
	FieldProps,
	SceneNode,
	ShapeGeometry,
	ShapeInstanceable,
	ShapeNode,
	ShapeProps,
} from "@sophistry/core";
import {
	coordsContext,
	createFieldEngine,
	defineComposite,
	defineShape,
	frameContext,
	Invalidate,
	shapeProps,
} from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import {
	forwardedProps,
	forwardHandlers,
	forwardProps,
} from "@sophistry/core/internal";
import { barbGlyph } from "../math/barbs";

/** The longest shaft, as a share of the lattice cell — barbs shouldn't collide. */
const DEFAULT_BARB_FILL = 0.8;
const DEFAULT_COLUMNS = 12;
const DEFAULT_BANDS = 10;

/** A band's shape: the outline its composite computed. */
interface BarbBandProps extends ShapeProps {
	outline?: ShapeGeometry;
}

const EMPTY_OUTLINE: ShapeGeometry = { polylines: [], closed: true };

/** Internal: not exported, so not a public definition. */
const barbBand = defineShape<BarbBandProps, ShapeInstanceable>({
	name: "BarbBand",
	props: { ...shapeProps, outline: { invalidates: Invalidate.GEOMETRY } },
	geometry: (props) => props.outline ?? EMPTY_OUTLINE,
});

/**
 * Props of {@link barbs}.
 *
 * @category Charts
 */
export interface BarbsProps extends FieldProps {
	/**
	 * Shaft length, the same for every barb (magnitude lives in the ticks). Defaults to most of one
	 * lattice cell.
	 */
	length?: number;
	/** Spacing between successive ticks. Defaults to `length / 6`. */
	barbSpacing?: number;
	/** Tick length. Defaults to `length / 2`. */
	barbLength?: number;
}

/** Barbs as band outlines: strokes first, then pennants (`fillFrom` between them). */
function barbBands(
	props: Readonly<BarbsProps>,
	engine: FieldEngine,
): ShapeGeometry[] {
	const glyphs: { at: Point; theta: number; magnitude: number }[] = [];
	let largest = 0;
	for (const point of engine.lattice().points) {
		const vector = props.function(point);
		if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) continue;
		const magnitude = Math.hypot(vector.x, vector.y);
		if (!(magnitude > 0) || !Number.isFinite(magnitude)) continue;
		const mapped = engine.toSceneVector(point, vector);
		if (!Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) continue;
		glyphs.push({
			at: engine.toScene(point),
			theta: Math.atan2(mapped.y, mapped.x),
			magnitude,
		});
		if (magnitude > largest) largest = magnitude;
	}
	const cell = engine.lattice().cell;
	const length =
		props.length ?? Math.min(cell.width, cell.height) * DEFAULT_BARB_FILL;
	const barbSpacing = props.barbSpacing ?? length / 6;
	const barbLength = props.barbLength ?? length / 2;
	const [low, high] = engine.magnitudeSpan(largest);
	const count = engine.bandCount();
	const strokePolylines: Point[][][] = Array.from({ length: count }, () => []);
	const fillPolylines: Point[][][] = Array.from({ length: count }, () => []);
	for (const glyph of glyphs) {
		const local = barbGlyph(glyph.magnitude, {
			shaftLength: length,
			barbSpacing,
			barbLength,
		});
		const cos = Math.cos(glyph.theta);
		const sin = Math.sin(glyph.theta);
		const toScene = ({ x: lx, y: ly }: Point): Point => ({
			x: glyph.at.x + lx * cos - ly * sin,
			y: glyph.at.y + lx * sin + ly * cos,
		});
		const index = engine.bandIndex(glyph.magnitude, low, high);
		local.segments.forEach((segment, i) => {
			const points = segment.map(toScene);
			// A pennant is the local frame's only closed (4-point) tick; every
			// other segment — the shaft and the open ticks — is a bare stroke.
			const isPennant = i >= 1 && i <= local.pennants;
			(isPennant ? fillPolylines : strokePolylines)[index]?.push(points);
		});
	}
	return strokePolylines.map((strokes, index) => ({
		closed: true,
		polylines: [...strokes, ...(fillPolylines[index] ?? [])],
		// Strokes are structure, pennants are area — see `ShapeGeometry.fillFrom`;
		// closing a two-point stroke back on itself draws nothing extra.
		fillFrom: strokes.length,
	}));
}

/** Shape props handed to every band as they are (the field decides stroke and fill). */
const FORWARDED = Object.keys(
	forwardedProps(shapeProps, ["stroke", "fill", "zIndex"]),
) as (keyof BarbsProps)[];

function build(ctx: CompositeContext<BarbsProps>): SceneNode[] {
	const props = ctx.props;
	const coords = ctx.context(coordsContext);
	const frame = ctx.context(frameContext);
	const engine = createFieldEngine(props, {
		coords,
		frame: () => frame.peek(),
		theme: ctx.theme,
	});
	const bands = barbBands(props, engine);
	const colors = engine.bandColors();
	const apply = (node: ShapeNode<BarbBandProps>, index: number) => {
		node.update({
			outline: bands[index],
			stroke: colors[index],
			fill: props.fill ?? colors[index],
			zIndex: props.zIndex,
		});
	};
	return ctx.list(
		"bands",
		bands.map((_, index) => index),
		{
			create: (index) => {
				const node = barbBand.create({}) as ShapeNode<BarbBandProps>;
				forwardProps(ctx, node, FORWARDED);
				apply(node, index);
				return node;
			},
			update: apply,
		},
	);
}

/**
 * A lattice of wind barbs: `function` is sampled on a lattice (see `FieldProps`) and each
 * vector, in data units, drawn as a barb whose half, full and pennant ticks encode magnitude.
 * Zero or non-finite vectors draw nothing. One shape per colour band. See {@link barbGlyph}
 * for the glyph alone.
 *
 * @example
 * ```ts
 * import { axes } from "@sophistry/core";
 * import { barbs } from "@sophistry/charts";
 *
 * axes.create({
 * 	width: 6,
 * 	height: 4,
 * 	xRange: [-3, 3, 1],
 * 	yRange: [-2, 2, 1],
 * 	children: [barbs.create({ function: (p) => ({ x: 20 - p.y * 8, y: p.x * 6 }), ramp: "viridis" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#marks
 * @category Charts
 */
export const barbs = defineComposite<BarbsProps>({
	name: "Barbs",
	props: {
		...forwardedProps(shapeProps),
		function: { invalidates: Invalidate.UPDATE },
		xRange: { invalidates: Invalidate.UPDATE },
		yRange: { invalidates: Invalidate.UPDATE },
		step: { invalidates: Invalidate.UPDATE },
		xStep: { invalidates: Invalidate.UPDATE },
		yStep: { invalidates: Invalidate.UPDATE },
		columns: { default: DEFAULT_COLUMNS, invalidates: Invalidate.UPDATE },
		ramp: { invalidates: Invalidate.UPDATE },
		magnitudeRange: { invalidates: Invalidate.UPDATE },
		bands: { default: DEFAULT_BANDS, invalidates: Invalidate.UPDATE },
		// Read by the engine (one colour, the default z), so not forwarded.
		stroke: { invalidates: Invalidate.UPDATE },
		fill: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		length: { invalidates: Invalidate.UPDATE },
		barbSpacing: { invalidates: Invalidate.UPDATE },
		barbLength: { invalidates: Invalidate.UPDATE },
	},
	setup: build,
	update: (changed, ctx) => {
		const children = build(ctx);
		for (const child of children) forwardHandlers(changed, ctx, child);
		return children;
	},
});
