/**
 * The spec an instances node publishes: its items' bank values, its shared
 * props and its space turned into one `MarksSpec`.
 *
 * Mark selection, cheapest first:
 *
 * 1. **`circle` / `rect`**: the shape declares an `instanceMark` adapter, it
 *    returns the same kind for every item, and every item's matrix keeps that
 *    kind (a similarity for a disc, axis-aligned for a box), and no item is
 *    partly revealed (a disc has no arc length to trace). The renderer can
 *    splat these.
 * 2. **`outline`**: no prop that invalidates the shape's geometry differs
 *    between items, so `geometry` runs once and every item places the same
 *    outline with its own linear part (`transforms`) and centre.
 * 3. **`paths`**: a geometry prop differs, so each item has its own outline,
 *    from `geometry` run per distinct set of geometry values (cached).
 *
 * Placement mirrors a shape node exactly: the local matrix is the shape
 * node's (`bakeLocalTransform`'s semantics, with `offset`, `place`, `origin`
 * and the default pivot at the outline's box centre), composed onto the
 * enclosing space, so an item lands where the equivalent single node would,
 * skew included (the outline is mapped point by point at paint time).
 *
 * Reveals: each item's arc-length reveal becomes `progresses` while any item
 * is below 1, and null once all are at 1, so a revealed layer publishes
 * exactly what it would without a reveal. The reveal is the `progress`
 * channel, or the shared `progress` for every item when there is none (as on
 * a single shape); the layer's own `progress` stays 1.
 *
 * Styles: per-item values become per-item arrays only when they differ
 * between items (fills, `strokes`, `strokeWidths`, `dashes`, `dashOffsets`,
 * `alphas`); otherwise they
 * stay in the shared `style`, baked by `bakeStrokeStyle` like a shape's. A
 * per-item `fillOpacity` is folded into each fill colour's alpha. A
 * shape's `styleProps` runs per item, as a shape node runs it. Gradient
 * fills, per-item gradient strokes and `strokeAlong` are rejected with an
 * error: a batched item has no paint frame of its own.
 *
 * Work: the placement pass (O(items)) reruns only when placement inputs
 * changed (a placement channel moved, the shared props, the space, the item
 * set); the style pass (O(items)) only when style inputs did. Each pass
 * keeps its arrays otherwise, and an unchanged spec keeps its identity.
 */

import { toCss, tryParseColor } from "../color/parse";
import type { Color } from "../color/types";
import type { Bounds, Point, Polyline } from "../geometry";
import { boundsOf, centerOf } from "../geometry/bounds";
import type { Matrix } from "../geometry/transform";
import { compose, IDENTITY, scaleFactorOf } from "../geometry/transform";
import type { ShapeGeometry } from "../spec/bake";
import {
	bakeLocalTransform,
	bakeStrokeStyle,
	derivePolylines,
	isSimilarity,
} from "../spec/bake";
import type { PaintSpec } from "../spec/gradient";
import { isGradientSpec } from "../spec/gradient";
import type { Placement } from "../spec/layout";
import { readDelta } from "../spec/layout";
import type {
	MarkOutline,
	MarkShape,
	MarksSpec,
	StrokeStyle,
} from "../spec/types";
import type { Theme } from "../themes/types";
import { Invalidate } from "./context";
import type { ChannelColumn, InstanceBank } from "./instance-bank";
import type { InstanceMark, ShapeOptions, ShapeProps } from "./shape";
import type { PropsDescriptor, Space } from "./types";

/**
 * The props that only style an item (everything else may place or shape it).
 *
 * @internal
 */
export const STYLE_KEYS: ReadonlySet<string> = new Set([
	"fill",
	"fillOpacity",
	"stroke",
	"strokeWidth",
	"opacity",
	"dashOffset",
]);

/**
 * The channel that reveals items along their outlines (it neither places nor
 * styles them, but a partly revealed layer is drawn from outlines).
 *
 * @internal
 */
export const REVEAL_KEY = "progress";

/**
 * Everything one build reads.
 *
 * @internal
 */
export interface InstanceLayerInput {
	/** The node's id (the spec's). */
	id: number;
	/** The item definition's name, for errors. */
	name: string;
	bank: InstanceBank;
	shape: ShapeOptions<ShapeProps>;
	descriptor: PropsDescriptor<ShapeProps>;
	/** The resolved shared props (bound values already pulled). */
	shared: Readonly<Record<string, unknown>>;
	theme: Theme;
	space: Space;
	/** Per slot, 1 for an item hidden by `promote`; null for none. */
	hidden: Uint8Array | null;
}

/**
 * What changed since the last build, as far as the node knows.
 *
 * @internal
 */
export interface LayerChanges {
	/** A placement input changed: a placement channel, the shared props, the space or the items. */
	placement: boolean;
	/**
	 * The only placement inputs that changed are move channels (props that
	 * invalidate `TRANSFORM` and not `GEOMETRY`), for the same items: discs
	 * and boxes keep their sizes, only their matrices are recomputed.
	 */
	moveOnly: boolean;
	/** A style input changed. */
	style: boolean;
	/** The `progress` channel changed (or the items did). */
	reveal: boolean;
}

/** One distinct outline, with what placing it needs. */
interface OutlineEntry {
	outline: MarkOutline;
	/** The `outline` mark using it (made on first use). */
	mark: MarkShape | null;
	/** Largest distance of any outline point (or control point) from the origin. */
	reach: number;
	/** Centre of the flattened outline's box: the default pivot. */
	pivot: Polyline[];
	/** The geometry's own `offset`, used when the shape has no `offset` function. */
	offset: Point | undefined;
}

/** A matrix being written in place. */
interface MutableMatrix {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

/** An item's style inputs, resolved. */
interface ItemStyle {
	fill: string;
	fillOpacity: number;
	stroke: PaintSpec;
	strokeWidth: number;
	opacity: number;
	/** Dash pattern in the item's own units, or undefined for solid. */
	dash: readonly number[] | undefined;
	/** Offset into the dash, in the item's own units. */
	dashOffset: number;
}

/** The placement pass's results. */
interface Placed {
	shape: MarkShape;
	centers: Float64Array;
	extents: Float64Array;
	transforms: Float64Array | null;
	/** Each item's pen scale (scene units per authored unit for its stroke). */
	penScales: Float64Array;
	bounds: Bounds | null;
	/**
	 * `circle`/`rect` placements: each item's disc radius, or box half-width
	 * and half-height, in its own units (what the adapter gave); null for
	 * outlines.
	 */
	markSizes: Float64Array | null;
	/** `circle`/`rect` placements: the linear part every item's matrix has, or null when they differ. */
	linear?: Readonly<LinearPart> | null;
	/** The space's pen scale the placement was made under. */
	penScale?: number;
}

/** A matrix's linear part. */
interface LinearPart {
	a: number;
	b: number;
	c: number;
	d: number;
}

/** The style pass's results. */
interface Styled {
	style: StrokeStyle;
	fills: readonly string[] | string;
	strokes: readonly string[] | null;
	strokeWidths: Float32Array | null;
	dashes: readonly (readonly number[] | null)[] | null;
	dashOffsets: Float32Array | null;
	alphas: Float32Array | null;
}

/** Most distinct outlines a `paths` layer keeps between builds (beyond its item count). */
const OUTLINE_CACHE_MIN = 1024;

/**
 * Builds an instances node's `MarksSpec`, keeping each pass's results until
 * its inputs change.
 *
 * @internal
 */
export class InstanceLayer {
	private placed: Placed | null = null;
	/** Whether `placed` was made for a partly revealed layer (outlines only). */
	private placedRevealing = false;
	private styled: Styled | null = null;
	/** Each item's reveal, null when every item is fully revealed. */
	private progresses: Float32Array | null = null;
	/** Whether `progresses` must be re-read before it is used. */
	private progressesStale = true;
	private spec: MarksSpec | null = null;
	/** Outlines by geometry values; dropped when the shared props change. */
	private outlines = new Map<string, OutlineEntry>();
	private outlinesShared: unknown = null;
	/** The props one item is evaluated with: the shared props, then its channels. */
	private scratch: Record<string, unknown> = {};
	private scratchShared: unknown = null;
	private readonly matrix: MutableMatrix = {
		a: 1,
		b: 0,
		c: 0,
		d: 1,
		e: 0,
		f: 0,
	};

	/** Drops every cached pass (the definition or channel set changed). */
	reset(): void {
		this.placed = null;
		this.styled = null;
		this.progresses = null;
		this.progressesStale = true;
		// The channel set changed: a former channel's value must not linger.
		this.scratchShared = null;
		this.spec = null;
		this.outlines.clear();
	}

	/**
	 * The spec for `input`, rerunning the placement pass when
	 * `changes.placement` (or the layer started or stopped revealing), the
	 * style pass when `changes.style` (or the pen scales changed) and the
	 * reveal pass when `changes.reveal`; the previous spec object while
	 * nothing did.
	 */
	build(input: InstanceLayerInput, changes: LayerChanges): MarksSpec | null {
		const { placement, moveOnly, reveal } = changes;
		let style = changes.style;
		const { shared, bank } = input;
		if (shared.visible === false || bank.size === 0) {
			this.spec = null;
			return null;
		}
		if (input.shared !== this.scratchShared) {
			this.scratch = { ...input.shared };
			this.scratchShared = input.shared;
		}
		let progresses = this.progresses;
		if (
			reveal ||
			this.progressesStale ||
			(progresses && progresses.length !== bank.size)
		) {
			progresses = revealsOf(bank, shared.progress as number | undefined);
			this.progresses = progresses;
			this.progressesStale = false;
		}
		// While any item is partly revealed, the layer is drawn from outlines:
		// discs and boxes have no arc length to trace.
		const revealing = progresses !== null;
		let placed = this.placed;
		if (
			placement ||
			!placed ||
			placed.centers.length !== bank.size * 2 ||
			revealing !== this.placedRevealing
		) {
			const next = this.place(
				input,
				revealing,
				moveOnly && revealing === this.placedRevealing ? placed : null,
			);
			this.placedRevealing = revealing;
			if (!placed || !samePenScales(placed.penScales, next.penScales))
				style = true;
			placed = next;
			this.placed = next;
		}
		let styled = this.styled;
		const strokeGradient = isGradientSpec(shared.stroke as PaintSpec);
		if (style || !styled || (strokeGradient && placement)) {
			styled = this.restyle(input, placed);
			this.styled = styled;
		}
		const last = this.spec;
		const zIndex = (shared.zIndex as number | undefined) ?? 0;
		const clip = input.space.clip;
		if (
			last &&
			last.shape === placed.shape &&
			last.centers === placed.centers &&
			last.extents === placed.extents &&
			last.transforms === placed.transforms &&
			last.style === styled.style &&
			last.fills === styled.fills &&
			last.strokes === styled.strokes &&
			last.strokeWidths === styled.strokeWidths &&
			last.dashes === styled.dashes &&
			(last.dashOffsets ?? null) === styled.dashOffsets &&
			(last.progresses ?? null) === progresses &&
			last.alphas === styled.alphas &&
			last.zIndex === zIndex &&
			last.clip === clip &&
			last.count === bank.size
		)
			return last;
		const spec: MarksSpec = {
			kind: "marks",
			id: input.id,
			zIndex,
			shape: placed.shape,
			count: bank.size,
			centers: placed.centers,
			extents: placed.extents,
			fills: styled.fills,
			alphas: styled.alphas,
			style: styled.style,
			// The reveal is per item (`progresses`), never a layer fade.
			progress: 1,
			bounds: placed.bounds,
			clip,
			transforms: placed.transforms,
			strokes: styled.strokes,
			strokeWidths: styled.strokeWidths,
			dashes: styled.dashes,
		};
		// Only when present, so a layer without them keeps its exact spec.
		if (styled.dashOffsets) spec.dashOffsets = styled.dashOffsets;
		if (progresses) spec.progresses = progresses;
		this.spec = spec;
		return spec;
	}

	/* ------------------------------------------------------- placement */

	/** Writes item `slot`'s values of `channels` into the scratch props. */
	private load(
		bank: InstanceBank,
		slot: number,
		channels: readonly ChannelColumn[],
	): Record<string, unknown> {
		const scratch = this.scratch;
		for (let c = 0; c < channels.length; c++) {
			const channel = channels[c] as ChannelColumn;
			scratch[channel.key] = bank.value(slot, channel);
		}
		return scratch;
	}

	/**
	 * Places the items: as discs or boxes when the adapter allows and no item
	 * is partly revealed, else as the shape's own outlines (the ones a shape
	 * node draws, so a reveal starts where the shape's does). `previous` is
	 * the last placement when only move channels changed since (see
	 * {@link LayerChanges.moveOnly}): its discs and boxes keep their sizes.
	 */
	private place(
		input: InstanceLayerInput,
		revealing: boolean,
		previous: Placed | null,
	): Placed {
		return (
			(revealing ? null : this.placeAsMarks(input, previous)) ??
			this.placeAsOutlines(input)
		);
	}

	/**
	 * The `circle`/`rect` placement, or null when the adapter does not cover
	 * every item. With a `previous` marks placement of as many items, the
	 * adapter is not asked again: it describes the outline, which only
	 * geometry props shape, so after a move each item keeps its disc or box
	 * and only its matrix is recomputed (from the move channels alone). When
	 * every item also keeps the linear part the previous placement shared
	 * (the items only translated), its extents and pen scales are the same
	 * numbers and their arrays are kept.
	 */
	private placeAsMarks(
		input: InstanceLayerInput,
		previous: Placed | null,
	): Placed | null {
		const adapter = input.shape.instanceMark;
		if (!adapter) return null;
		const { bank, space, shared } = input;
		const count = bank.size;
		const known =
			previous?.markSizes && previous.centers.length === count * 2
				? previous
				: null;
		const channels = known
			? moveChannels(bank, input.descriptor)
			: placementChannels(bank);
		const offsetOf = input.shape.offset;
		const place = placeDelta(shared.place as Placement | undefined);
		let kind: InstanceMark["kind"] | null = known
			? known.shape === RECT_SHAPE
				? "rect"
				: "circle"
			: null;
		const width = kind === "rect" ? count * 2 : count;
		// Each item's disc radius, or box half-width and half-height.
		let sizes: Float64Array | null = known
			? (known.markSizes as Float64Array)
			: null;
		const centers = new Float64Array(count * 2);
		// The previous extents and pen scales, kept while every item has the
		// linear part they were made with; copied out at the first that
		// does not.
		const kept =
			known?.linear && known.penScale === space.penScale ? known.linear : null;
		let extents: Float64Array | null = kept
			? (known?.extents ?? null)
			: kind === null
				? null
				: new Float64Array(width);
		let penScales = kept ? (known?.penScales as Float64Array) : null;
		penScales ??= new Float64Array(count);
		let keeping = kept !== null;
		const fixed = fixedTranslation(channels, this.scratch, place);
		const m = this.matrix;
		// The linear part is usually the same from item to item (only centres
		// differ): its scale and similarity are measured when it changes.
		let linearA = Number.NaN;
		let linearB = Number.NaN;
		let linearC = Number.NaN;
		let linearD = Number.NaN;
		let linearScale = 1;
		let similar = true;
		let uniform = true;
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (let slot = 0; slot < count; slot++) {
			const props = this.load(bank, slot, channels);
			if (!known) {
				const mark = adapter(props as Readonly<ShapeProps>);
				if (!mark || (kind !== null && mark.kind !== kind)) return null;
				if (kind === null) {
					kind = mark.kind;
					const length = kind === "rect" ? count * 2 : count;
					extents = new Float64Array(length);
					sizes = new Float64Array(length);
				}
				const out = sizes as Float64Array;
				if (mark.kind === "circle") out[slot] = mark.radius;
				else {
					out[2 * slot] = mark.halfWidth;
					out[2 * slot + 1] = mark.halfHeight;
				}
			}
			// A disc or box is symmetric about the origin: its box centre (the
			// default pivot) is the origin.
			const offset = offsetOf ? offsetOf(props) : undefined;
			if (fixed) {
				translationMatrix(
					m,
					fixed.x + (offset !== undefined ? offset.x : 0),
					fixed.y + (offset !== undefined ? (offset.y ?? 0) : 0),
					space.matrix,
				);
			} else itemMatrix(m, props, place, offset, ORIGIN_PIVOT, space.matrix);
			if (
				m.a !== linearA ||
				m.b !== linearB ||
				m.c !== linearC ||
				m.d !== linearD
			) {
				if (slot > 0) uniform = false;
				linearA = m.a;
				linearB = m.b;
				linearC = m.c;
				linearD = m.d;
				linearScale = scaleFactorOf(m);
				similar = isTranslation(m) || isSimilarity(m);
				if (
					keeping &&
					kept &&
					(m.a !== kept.a || m.b !== kept.b || m.c !== kept.c || m.d !== kept.d)
				) {
					// This item's linear part differs: from here on the arrays are
					// new, the items before it copied (their numbers are the same).
					keeping = false;
					extents = (extents as Float64Array).slice();
					penScales = penScales.slice();
				}
			}
			const size = sizes as Float64Array;
			const out = extents as Float64Array;
			let extentX: number;
			let extentY: number;
			if (kind === "circle") {
				if (!similar) return null;
				if (keeping) extentX = out[slot] as number;
				else {
					extentX = (size[slot] as number) * linearScale;
					out[slot] = extentX;
				}
				extentY = extentX;
			} else {
				if (m.b !== 0 || m.c !== 0) return null;
				if (keeping) {
					extentX = out[2 * slot] as number;
					extentY = out[2 * slot + 1] as number;
				} else {
					extentX = (size[2 * slot] as number) * Math.abs(m.a);
					extentY = (size[2 * slot + 1] as number) * Math.abs(m.d);
					out[2 * slot] = extentX;
					out[2 * slot + 1] = extentY;
				}
			}
			const x = m.e;
			const y = m.f;
			centers[2 * slot] = x;
			centers[2 * slot + 1] = y;
			if (!keeping) penScales[slot] = space.penScale ?? linearScale;
			// The union box, as `itemsBounds` measures it, in the same pass.
			if (
				Number.isFinite(x) &&
				Number.isFinite(y) &&
				extentX >= 0 &&
				extentY >= 0
			) {
				if (x - extentX < minX) minX = x - extentX;
				if (x + extentX > maxX) maxX = x + extentX;
				if (y - extentY < minY) minY = y - extentY;
				if (y + extentY > maxY) maxY = y + extentY;
			}
		}
		const shape: MarkShape = kind === "rect" ? RECT_SHAPE : CIRCLE_SHAPE;
		return {
			shape,
			centers,
			extents: extents ?? new Float64Array(0),
			transforms: null,
			penScales,
			bounds: minX <= maxX ? { minX, minY, maxX, maxY } : null,
			markSizes: sizes,
			linear:
				uniform && count > 0
					? { a: linearA, b: linearB, c: linearC, d: linearD }
					: null,
			penScale: space.penScale,
		};
	}

	/** The `outline` placement, or `paths` when a geometry prop differs between items. */
	private placeAsOutlines(input: InstanceLayerInput): Placed {
		const { bank, space, shared, descriptor } = input;
		const count = bank.size;
		const channels = placementChannels(bank);
		if (this.outlinesShared !== shared) {
			this.outlines.clear();
			this.outlinesShared = shared;
		}
		const geometryChannels = bank.channels.filter(
			(channel) =>
				!STYLE_KEYS.has(channel.key) &&
				channel.key !== REVEAL_KEY &&
				((descriptor as Record<string, { invalidates: number }>)[channel.key]
					?.invalidates ?? 0) & Invalidate.GEOMETRY,
		);
		const uniform = geometryChannels.every((channel) =>
			sameAcross(bank, channel),
		);
		const offsetOf = input.shape.offset;
		const place = placeDelta(shared.place as Placement | undefined);
		const centers = new Float64Array(count * 2);
		const extents = new Float64Array(count);
		const transforms = new Float64Array(count * 4);
		const penScales = new Float64Array(count);
		const outlines: MarkOutline[] | null = uniform ? null : new Array(count);
		let identity = true;
		let shared0: OutlineEntry | null = null;
		const m = this.matrix;
		for (let slot = 0; slot < count; slot++) {
			const props = this.load(bank, slot, channels);
			let entry: OutlineEntry;
			if (uniform) {
				shared0 ??= this.outlineFor(input, props, geometryChannels);
				entry = shared0;
			} else {
				entry = this.outlineFor(input, props, geometryChannels);
				(outlines as MarkOutline[])[slot] = entry.outline;
			}
			itemMatrix(
				m,
				props,
				place,
				offsetOf ? offsetOf(props) : entry.offset,
				entry.pivot,
				space.matrix,
			);
			centers[2 * slot] = m.e;
			centers[2 * slot + 1] = m.f;
			transforms[4 * slot] = m.a;
			transforms[4 * slot + 1] = m.b;
			transforms[4 * slot + 2] = m.c;
			transforms[4 * slot + 3] = m.d;
			if (m.a !== 1 || m.b !== 0 || m.c !== 0 || m.d !== 1) identity = false;
			extents[slot] = entry.reach * largestStretch(m);
			penScales[slot] = space.penScale ?? scaleFactorOf(m);
		}
		let shape: MarkShape;
		if (uniform && shared0) {
			shared0.mark ??= { kind: "outline", ...shared0.outline };
			shape = shared0.mark;
		} else shape = { kind: "paths", outlines: outlines ?? [] };
		this.trimOutlines(count);
		return {
			shape,
			centers,
			extents,
			transforms: identity ? null : transforms,
			penScales,
			bounds: itemsBounds(centers, extents, count, false),
			markSizes: null,
		};
	}

	/** The outline for these props, from the cache or a `geometry` run. */
	private outlineFor(
		input: InstanceLayerInput,
		props: Record<string, unknown>,
		geometryChannels: readonly ChannelColumn[],
	): OutlineEntry {
		const key = geometryKey(props, geometryChannels);
		let entry = this.outlines.get(key);
		if (entry) return entry;
		// A copy: `geometry` gets props it may keep, not the scratch object.
		const result = input.shape.geometry({ ...props } as Readonly<ShapeProps>);
		if (isPromise(result)) {
			throw new Error(
				`instances: ${input.name}'s geometry is asynchronous; instances() needs an outline at once. Use separate nodes for it.`,
			);
		}
		entry = outlineEntry(result);
		this.outlines.set(key, entry);
		return entry;
	}

	/** Keeps the outline cache from growing past the layer's needs. */
	private trimOutlines(count: number): void {
		if (this.outlines.size > Math.max(OUTLINE_CACHE_MIN, count * 2))
			this.outlines.clear();
	}

	/* ----------------------------------------------------------- style */

	private restyle(input: InstanceLayerInput, placed: Placed): Styled {
		const { bank, theme, space, hidden, name } = input;
		const count = bank.size;
		const styleProps = input.shape.styleProps;
		const items: ItemStyle[] = new Array(count);
		let source0: Readonly<ShapeProps> | null = null;
		for (let slot = 0; slot < count; slot++) {
			const props = this.load(
				bank,
				slot,
				bank.channels,
			) as Readonly<ShapeProps>;
			const source = styleProps ? styleProps(props, theme) : props;
			if (slot === 0) source0 = styleProps ? source : { ...source };
			items[slot] = itemStyle(source, theme, name);
		}
		const first = items[0] as ItemStyle;
		const base = source0 as Readonly<ShapeProps>;
		if (base.strokeAlong !== undefined) {
			throw new Error(
				`instances: ${name} items cannot use strokeAlong; give each item a stroke colour instead.`,
			);
		}

		// Which values differ between items.
		// Without any visible stroke, per-item stroke colours and widths draw
		// nothing: leave them out, so the layer stays splat-able.
		const anyStroke = items.some(
			(item) => item.stroke !== "none" && item.strokeWidth > 0,
		);
		let fillsDiffer = false;
		let fillOpacitiesDiffer = false;
		let strokesDiffer = false;
		let opacitiesDiffer = hidden !== null;
		let widthsDiffer = false;
		let dashesDiffer = false;
		let offsetsDiffer = false;
		const penScales = placed.penScales;
		const width0 = first.strokeWidth * (penScales[0] ?? 1);
		const offset0 = first.dashOffset * (penScales[0] ?? 1);
		for (let slot = 1; slot < count; slot++) {
			const item = items[slot] as ItemStyle;
			if (item.fill !== first.fill) fillsDiffer = true;
			if (item.fillOpacity !== first.fillOpacity) fillOpacitiesDiffer = true;
			if (item.stroke !== first.stroke) strokesDiffer = true;
			if (item.opacity !== first.opacity) opacitiesDiffer = true;
			if (item.strokeWidth * (penScales[slot] as number) !== width0)
				widthsDiffer = true;
			if (
				!sameDash(item.dash, first.dash) ||
				(item.dash && penScales[slot] !== penScales[0])
			)
				dashesDiffer = true;
			if (item.dashOffset * (penScales[slot] as number) !== offset0)
				offsetsDiffer = true;
		}

		let fills: readonly string[] | string = first.fill;
		if (fillOpacitiesDiffer) {
			fills = items.map((item) => withAlpha(item.fill, item.fillOpacity));
		} else if (fillsDiffer) fills = items.map((item) => item.fill);

		let strokes: string[] | null = null;
		if (strokesDiffer && anyStroke) {
			strokes = items.map((item) => {
				if (typeof item.stroke !== "string") {
					throw new Error(
						`instances: ${name} items cannot stroke with different gradients; use colours per item, or one shared gradient.`,
					);
				}
				return item.stroke;
			});
		}

		let strokeWidths: Float32Array | null = null;
		let widest = width0;
		if (widthsDiffer && anyStroke) {
			strokeWidths = new Float32Array(count);
			for (let slot = 0; slot < count; slot++) {
				const width =
					(items[slot] as ItemStyle).strokeWidth * (penScales[slot] as number);
				strokeWidths[slot] = width;
				if (width > widest) widest = width;
			}
		}

		// Dashes scale with each item's pen, like a shape node's.
		let dashes: (readonly number[] | null)[] | null = null;
		if (dashesDiffer && anyStroke) {
			dashes = items.map((item, slot) => {
				const scale = penScales[slot] as number;
				return item.dash ? item.dash.map((length) => length * scale) : null;
			});
		}

		// Offsets too, and only where some item is dashed (a solid stroke has
		// none to shift).
		let dashOffsets: Float32Array | null = null;
		if (
			offsetsDiffer &&
			anyStroke &&
			items.some((item) => item.dash && item.dash.length > 0)
		) {
			dashOffsets = new Float32Array(count);
			for (let slot = 0; slot < count; slot++) {
				dashOffsets[slot] =
					(items[slot] as ItemStyle).dashOffset * (penScales[slot] as number);
			}
		}

		let alphas: Float32Array | null = null;
		if (opacitiesDiffer) {
			alphas = new Float32Array(count);
			for (let slot = 0; slot < count; slot++) {
				alphas[slot] = hidden?.[slot] ? 0 : (items[slot] as ItemStyle).opacity;
			}
		}

		const bounds = placed.bounds;
		const style = bakeStrokeStyle(
			{
				stroke: strokes ? "none" : first.stroke,
				strokeWidth: first.strokeWidth,
				fill: undefined,
				opacity: alphas ? 1 : first.opacity,
				fillOpacity: fillOpacitiesDiffer ? 1 : first.fillOpacity,
				dash: first.dash as number[] | undefined,
				dashOffset: base.dashOffset,
				lineCap: base.lineCap,
				lineJoin: base.lineJoin,
			},
			theme,
			penScales[0] ?? 1,
			space.opacity,
			// A shared gradient stroke spans the layer's box, in scene units.
			() => ({
				box: bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
				toScene: (at) => at,
				sceneUnitsPerUnit: 1,
			}),
		);
		// Per-item strokes override the shared paint; the widest width keeps
		// every reader that pads by `style.strokeWidth` conservative.
		if (strokes)
			style.stroke = strokes.find((stroke) => stroke !== "none") ?? "none";
		if (strokeWidths) style.strokeWidth = widest;
		return { style, fills, strokes, strokeWidths, dashes, dashOffsets, alphas };
	}
}

/* --------------------------------------------------------------- helpers */

const CIRCLE_SHAPE: MarkShape = Object.freeze({ kind: "circle" });
const RECT_SHAPE: MarkShape = Object.freeze({ kind: "rect" });
/** The default pivot of an outline symmetric about the origin. */
const ORIGIN_PIVOT: Polyline[] = [[{ x: 0, y: 0 }]];

/**
 * The placement channels that only move items (their props invalidate
 * `TRANSFORM`, not `GEOMETRY`): all an item's matrix reads.
 */
function moveChannels(
	bank: InstanceBank,
	descriptor: PropsDescriptor<ShapeProps>,
): ChannelColumn[] {
	return placementChannels(bank).filter((channel) =>
		isMoveProp(descriptor, channel.key),
	);
}

/** Whether `key` only moves an item (`TRANSFORM` without `GEOMETRY`). */
export function isMoveProp(
	descriptor: PropsDescriptor<ShapeProps>,
	key: string,
): boolean {
	const invalidates =
		(descriptor as Record<string, { invalidates?: number } | undefined>)[key]
			?.invalidates ?? 0;
	return (
		(invalidates & Invalidate.TRANSFORM) !== 0 &&
		(invalidates & Invalidate.GEOMETRY) === 0
	);
}

/** The channels that place or shape items (neither style nor reveal). */
function placementChannels(bank: InstanceBank): ChannelColumn[] {
	return bank.channels.filter(
		(channel) => !STYLE_KEYS.has(channel.key) && channel.key !== REVEAL_KEY,
	);
}

/** `place` as a delta. */
function placeDelta(place: Placement | undefined): Point {
	return place ? readDelta(place) : { x: 0, y: 0 };
}

function isTranslation(m: Matrix): boolean {
	return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;
}

/** A thenable. */
function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

/**
 * Writes an item's matrix (its space's matrix with its local TRS on top) into
 * `out`, exactly as a shape node computes it: the pure-translation case
 * inline, the rest through `bakeLocalTransform` with the outline's box
 * centre as the default pivot.
 */
function itemMatrix(
	out: MutableMatrix,
	props: Record<string, unknown>,
	place: Point,
	offset: Point | undefined,
	pivot: Polyline[],
	space: Matrix,
): void {
	const rotation = props.rotation as number | undefined;
	const scale = props.scale as number | undefined;
	const x = props.x as number | undefined;
	const y = props.y as number | undefined;
	if (!rotation && (scale === undefined || scale === 1)) {
		const hasOffset = offset !== undefined;
		translationMatrix(
			out,
			(x ?? 0) + place.x + (hasOffset ? offset.x : 0),
			(y ?? 0) + place.y + (hasOffset ? (offset.y ?? 0) : 0),
			space,
		);
		return;
	}
	const local = bakeLocalTransform(
		{ x, y, rotation, scale, origin: props.origin as Point | undefined },
		place,
		() => pivot,
		offset === undefined ? undefined : { x: offset.x, y: offset.y },
	) as Matrix;
	const m = space === IDENTITY ? local : compose(space, local);
	out.a = m.a;
	out.b = m.b;
	out.c = m.c;
	out.d = m.d;
	out.e = m.e;
	out.f = m.f;
}

/** The props an item's local transform reads besides its offset. */
const LOCAL_TRANSFORM_KEYS: ReadonlySet<string> = new Set([
	"x",
	"y",
	"rotation",
	"scale",
	"origin",
]);

/**
 * The translation every item shares before its offset (`x`/`y` plus
 * `place`), when none of the local transform props is a channel and the
 * shared ones neither rotate nor scale: then an item's matrix is the space
 * translated by that plus its offset. Null otherwise.
 */
function fixedTranslation(
	channels: readonly ChannelColumn[],
	props: Record<string, unknown>,
	place: Point,
): Point | null {
	for (const channel of channels)
		if (LOCAL_TRANSFORM_KEYS.has(channel.key)) return null;
	const scale = props.scale as number | undefined;
	if (props.rotation || !(scale === undefined || scale === 1)) return null;
	return {
		x: ((props.x as number | undefined) ?? 0) + place.x,
		y: ((props.y as number | undefined) ?? 0) + place.y,
	};
}

/** Writes `space` composed with a translation by `(tx, ty)` into `out`: `itemMatrix` without rotation or scale. */
function translationMatrix(
	out: MutableMatrix,
	tx: number,
	ty: number,
	space: Matrix,
): void {
	if (!(tx || ty)) {
		out.a = space.a;
		out.b = space.b;
		out.c = space.c;
		out.d = space.d;
		out.e = space.e;
		out.f = space.f;
	} else if (space === IDENTITY) {
		out.a = 1;
		out.b = 0;
		out.c = 0;
		out.d = 1;
		out.e = tx;
		out.f = ty;
	} else {
		// `compose(space, translate(tx, ty))`, without the two objects.
		out.a = space.a * 1 + space.c * 0;
		out.b = space.b * 1 + space.d * 0;
		out.c = space.a * 0 + space.c * 1;
		out.d = space.b * 0 + space.d * 1;
		out.e = space.a * tx + space.c * ty + space.e;
		out.f = space.b * tx + space.d * ty + space.f;
	}
}

/** The largest factor `m`'s linear part stretches any direction by (its larger singular value). */
function largestStretch(m: MutableMatrix): number {
	if (m.b === 0 && m.c === 0) return Math.max(Math.abs(m.a), Math.abs(m.d));
	const sum = m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d;
	const det = m.a * m.d - m.b * m.c;
	const root = Math.sqrt(Math.max(0, sum * sum - 4 * det * det));
	return Math.sqrt((sum + root) / 2);
}

/** A shape geometry's outline, reach and default pivot. */
function outlineEntry(geometry: ShapeGeometry): OutlineEntry {
	const polylines = derivePolylines(geometry);
	const curvePaths = geometry.curvePaths ?? null;
	let reach2 = 0;
	const take = (p: Point) => {
		const r2 = p.x * p.x + p.y * p.y;
		if (r2 > reach2) reach2 = r2;
	};
	for (const line of polylines) for (const p of line) take(p);
	if (curvePaths) {
		// Control points enclose a Bézier, so their reach holds the curve.
		for (const path of curvePaths) {
			take(path.start);
			for (const segment of path.segments) {
				take(segment.c1);
				take(segment.c2);
				take(segment.to);
			}
		}
	}
	const hasPoints = polylines.some((line) => line.length > 0);
	// A one-point outline whose box centre is the outline's: what
	// `bakeLocalTransform` measures for the default pivot, measured once.
	const pivot: Polyline[] = [
		[hasPoints ? centerOf(boundsOf(polylines)) : { x: 0, y: 0 }],
	];
	return {
		outline: { polylines, curvePaths, closed: geometry.closed },
		mark: null,
		reach: Math.sqrt(reach2),
		pivot,
		offset: geometry.offset,
	};
}

/** The cache key of an item's geometry values. */
function geometryKey(
	props: Record<string, unknown>,
	channels: readonly ChannelColumn[],
): string {
	if (channels.length === 0) return "";
	let key = "";
	for (const channel of channels) {
		const value = props[channel.key];
		key += `${keyPart(value)}|`;
	}
	return key;
}

/** Objects by identity, for geometry keys of values that are not numbers or points. */
const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

function keyPart(value: unknown): string {
	if (value === undefined) return "u";
	if (typeof value === "number") return `n${value}`;
	if (typeof value === "string") return `s${value}`;
	if (typeof value === "object" && value !== null) {
		const point = value as { x?: unknown; y?: unknown };
		if (typeof point.x === "number" && typeof point.y === "number")
			return `p${point.x},${point.y}`;
		let id = objectIds.get(value);
		if (id === undefined) {
			id = nextObjectId++;
			objectIds.set(value, id);
		}
		return `o${id}`;
	}
	return `v${String(value)}`;
}

/** Whether every item has the same value for `channel`. */
function sameAcross(bank: InstanceBank, channel: ChannelColumn): boolean {
	const count = bank.size;
	if (count < 2) return true;
	if (
		channel.kind === "number" ||
		channel.kind === "point" ||
		channel.kind === "color"
	) {
		const width = channel.width;
		const current = channel.current;
		for (let slot = 1; slot < count; slot++) {
			for (let k = 0; k < width; k++) {
				const a = current[k];
				const b = current[slot * width + k];
				if (a !== b && !(Number.isNaN(a) && Number.isNaN(b))) return false;
			}
			// Equal floats can still be different raw values (undefined against
			// the default): those make different props.
			if (
				(channel.targets[slot] === undefined) !==
				(channel.targets[0] === undefined)
			)
				return false;
		}
		return true;
	}
	const first = bank.value(0, channel);
	for (let slot = 1; slot < count; slot++) {
		if (!Object.is(bank.value(slot, channel), first)) return false;
	}
	return true;
}

/**
 * Each item's reveal, clamped to 0..1: its `progress` channel, or the shared
 * `progress` for every item when there is no channel (a shared value means on
 * each item what it means on a single shape). Null when every item is fully
 * revealed.
 */
function revealsOf(
	bank: InstanceBank,
	shared: number | undefined,
): Float32Array | null {
	const count = bank.size;
	const channel = bank.channels.find((column) => column.key === REVEAL_KEY);
	if (channel?.kind !== "number") {
		// No value or NaN draws whole, as a shape's missing progress does.
		if (shared === undefined || !(shared < 1)) return null;
		return new Float32Array(count).fill(Math.max(0, shared));
	}
	const current = channel.current;
	let partial = false;
	for (let slot = 0; slot < count && !partial; slot++)
		if ((current[slot] as number) < 1) partial = true;
	if (!partial) return null;
	const progresses = new Float32Array(count);
	for (let slot = 0; slot < count; slot++) {
		const value = current[slot] as number;
		// NaN (no number given) draws whole, as a shape's missing progress does.
		progresses[slot] = value < 1 ? Math.max(0, value) : 1;
	}
	return progresses;
}

/** An item's style inputs with the shape node's defaults. */
function itemStyle(
	source: Readonly<ShapeProps>,
	theme: Theme,
	name: string,
): ItemStyle {
	const fill = source.fill;
	if (fill !== undefined && isGradientSpec(fill)) {
		throw new Error(
			`instances: ${name} items cannot be filled with a gradient; give them colours (or use separate nodes).`,
		);
	}
	const stroke = source.stroke ?? theme.palette.foreground;
	return {
		fill: fill === undefined ? "none" : toCss(fill as string | Color),
		fillOpacity: source.fillOpacity ?? 1,
		stroke: isGradientSpec(stroke) ? stroke : toCss(stroke as string | Color),
		strokeWidth: source.strokeWidth ?? theme.defaults.strokeWidth,
		opacity: source.opacity ?? 1,
		dash: source.dash,
		dashOffset: source.dashOffset ?? 0,
	};
}

/** Parsed fills, for folding a per-item fill opacity into them. */
const parsedFills = new Map<string, Color | null>();

/** `fill` with its alpha multiplied by `alpha`; `"none"` stays. */
function withAlpha(fill: string, alpha: number): string {
	if (alpha === 1 || fill === "none" || fill === "") return fill;
	let color = parsedFills.get(fill);
	if (color === undefined) {
		color = tryParseColor(fill);
		if (parsedFills.size > 4096) parsedFills.clear();
		parsedFills.set(fill, color);
	}
	if (!color) return fill;
	return toCss({ r: color.r, g: color.g, b: color.b, a: color.a * alpha });
}

/** Whether two dash patterns are the same (by content). */
function sameDash(
	a: readonly number[] | undefined,
	b: readonly number[] | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** Whether two pen-scale arrays hold the same values. */
function samePenScales(a: Float64Array, b: Float64Array): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** The items' union box (centre plus extent each), or null with none finite. */
function itemsBounds(
	centers: Float64Array,
	extents: Float64Array,
	count: number,
	rect: boolean,
): Bounds | null {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < count; i++) {
		const x = centers[2 * i];
		const y = centers[2 * i + 1];
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		const ex = rect ? extents[2 * i] : extents[i];
		const ey = rect ? extents[2 * i + 1] : ex;
		if (!(ex >= 0 && ey >= 0)) continue;
		if (x - ex < minX) minX = x - ex;
		if (x + ex > maxX) maxX = x + ex;
		if (y - ey < minY) minY = y - ey;
		if (y + ey > maxY) maxY = y + ey;
	}
	return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}
