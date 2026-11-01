/**
 * `vectorField` and `streamLines`: one function `(point) => vector` drawn as
 * arrows or as flow lines, in data coordinates inside a coordinate system and
 * scene units outside one.
 *
 * Magnitude is measured on screen, after mapping through the coordinate system.
 * Colour comes from `ramp`, quantised into `bands`, and each band is one node,
 * so a large field stays a handful of nodes (and a `progress` reveal goes band
 * by band). `streamLines` with `colorAlong` cuts each line at band boundaries.
 *
 * Both are composites over one shape per band. The bands are recomputed when
 * the field's own props, the coordinate system or the theme change; style
 * props are bound straight through. A field with no coordinate system and no
 * explicit ranges covers the visible frame: its bands are then a `derive` of
 * the frame, so a pan re-samples it without any `update`, and a field with
 * ranges never reads the frame at all.
 */

import type { ColorInput } from "../color/index.js";
import type {
	Bounds,
	CurvePath,
	Point,
	Polyline,
	Range,
	TipShape,
	VectorFn,
} from "../geometry/index.js";
import {
	fieldJitter,
	polylineToCurvePath,
	streamline,
	streamlineBothWays,
	tickValues,
	tipIsClosed,
	tipPolylines,
} from "../geometry/index.js";
import { isFinitePoint } from "../geometry/num.js";
import type { Readable } from "../reactive/index.js";
import { derive, track } from "../reactive/index.js";
import type {
	Changes,
	CompositeContext,
	CompositeNode,
} from "../scene/composite.js";
import { defineComposite } from "../scene/composite.js";
import { frameContext, Invalidate, themeContext } from "../scene/context.js";
import type { ShapeNode, ShapeProps } from "../scene/shape.js";
import { shapeProps } from "../scene/shape.js";
import type { Definition, PropsDescriptor, SceneNode } from "../scene/types.js";
import {
	forwardedProps,
	forwardHandlers,
	forwardProps,
} from "../shapes/forward.js";
import type { ShapeGeometry } from "../spec/bake.js";
import type { ColorRampSpec } from "../spec/colorRampProp.js";
import { isStopList } from "../spec/colorRampProp.js";
import type { PaintSpec } from "../spec/gradient.js";
import { isGradientSpec } from "../spec/gradient.js";
import { colorRamp, resolveColormap } from "../themes/index.js";
import type { Theme } from "../themes/types.js";
import type { CoordinateSystem } from "./coords.js";
import { coordsContext, UNDER_AXES_Z_INDEX } from "./coords.js";
import type { OutlineProps } from "./function-graph.js";
import { needsRebuild, outline } from "./function-graph.js";

/** Target samples across x when no step is named. */
const DEFAULT_COLUMNS = 12;
/** Per-axis sample cap, as `numberPlane` caps its grid lines. */
const MAX_PER_AXIS = 48;
/**
 * Total sample cap. A range and a step are two independent numbers, and
 * `[0, 100]` with a step of 0.01 is a typo that would otherwise ask for a
 * hundred million arrows. Past this the lattice is thinned by stride: coarser
 * than asked for, still a field.
 */
const MAX_SAMPLES = 900;
const DEFAULT_BANDS = 10;
/** The longest arrow, as a share of the lattice cell — arrows shouldn't collide. */
const DEFAULT_ARROW_FILL = 0.75;
/** Tip extent as a share of the arrow's own length, so short arrows keep a head. */
const TIP_RATIO = 0.34;
const DEFAULT_STREAM_STEPS = 60;
/** Seed jitter, as a share of the lattice spacing. */
const DEFAULT_NOISE = 0.4;
/**
 * How far a typical particle should travel in the default `virtualTime`, as a
 * share of the plot's shorter side. Long enough to read as flow, short enough
 * that the lines don't all pile into the same attractor.
 */
const DEFAULT_CROSSING = 0.55;

function everyNth<T>(values: T[], stride: number): T[] {
	return stride <= 1
		? values
		: values.filter((_, index) => index % stride === 0);
}

/**
 * The imperative half of a field, for reading vectors and flow lines out of
 * it (to ride a dot along it, say). Made by {@link fieldHandle}; its methods
 * read the node's current props and coordinate system on every call.
 *
 * @category Coordinate systems & graphs
 */
export interface VectorFieldHandle {
	/** The sampled region, in **field** coordinates. */
	domain(): Bounds;
	/** Field coordinates → scene units, the field's own `coordsToPoint`. */
	toScene(at: Point): Point;
	/**
	 * The vector at a field-space point, in **scene** units.
	 *
	 * Manim's `VectorField.nudge` is this plus a step: add `vectorAt(p) * dt` to
	 * a dot's position each frame and it drifts along the flow.
	 */
	vectorAt(at: Point): Point;
	/**
	 * The flow line through a field-space point, in **scene** units — ready for
	 * `path.create({ points })` or `moveAlong`, which is how a particle rides the
	 * field without this module owning an animation.
	 */
	streamlineAt(
		at: Point,
		options?: { steps?: number; virtualTime?: number; both?: boolean },
	): Polyline;
}

/**
 * The props every field takes: what it samples, where, and in what colours.
 *
 * @category Coordinate systems & graphs
 */
export interface FieldProps extends ShapeProps {
	/** The field. Point in, vector out, both in field coordinates. */
	function: VectorFn;
	/**
	 * Sampled x region in field units; pass the range to make the field view-independent. Defaults
	 * to the coordinate system's x range, or the visible frame outside one — the frame is live, so
	 * without a coordinate system or an explicit range the lattice is re-sampled on every pan and
	 * zoom.
	 */
	xRange?: Range;
	/**
	 * Sampled y region in field units. Defaults to the coordinate system's y range, or the visible
	 * frame outside one (live, as for `xRange`).
	 */
	yRange?: Range;
	/** Lattice spacing in field units: samples sit midway between multiples of it. `step` sets both axes. */
	step?: number;
	/** Lattice spacing along x in field units; overrides `step`. */
	xStep?: number;
	/** Lattice spacing along y in field units; overrides `step`. */
	yStep?: number;
	/**
	 * Target samples across x when no step is given.
	 * @default 12
	 */
	columns?: number;
	/**
	 * Colour ramp, low magnitude first: an explicit stop list, a published
	 * colormap's name, or a caller's own `(t: number) => string`. Defaults to
	 * two theme series colours. A plain `stroke` instead, with `ramp`
	 * omitted, means one colour and no ramp — a single-entry stop list
	 * (`ramp: [c]`) does too, but a colormap name or function is always a
	 * full ramp, since there's no single "the" colour to read off one.
	 */
	ramp?: ColorRampSpec;
	/** Magnitudes (in scene units) the ramp spans. Defaults to `[0, largest]`. */
	magnitudeRange?: [number, number];
	/**
	 * Colour steps, and so the node count.
	 * @default 10
	 */
	bands?: number;
}

/** A field's own props: everything in {@link FieldProps} but the shape props. */
const fieldOwnProps = {
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
	zIndex: { invalidates: Invalidate.UPDATE },
} as const;

interface Lattice {
	points: Point[];
	/** Lattice spacing in field units. */
	spacing: { x: number; y: number };
	/** The same cell, in scene units — what arrow lengths are measured against. */
	cell: { width: number; height: number };
}

/**
 * What a field engine reads besides the props.
 *
 * @category Coordinate systems & graphs
 */
export interface FieldEnvironment {
	/** The enclosing coordinate system, or null for scene units. */
	coords: CoordinateSystem | null;
	/**
	 * The visible frame in scene units. Called only for an axis nothing else
	 * defines (no range, no coordinate system).
	 */
	frame: () => Bounds;
	/** The active theme (the default ramp's colours). */
	theme: Theme;
}

/**
 * The shared machine of {@link vectorField} and {@link streamLines}: domain,
 * mapping, lattice, colour bands, and the timing a flow line needs.
 *
 * @category Coordinate systems & graphs
 */
export interface FieldEngine {
	/** The sampled region, in field coordinates. */
	domain(): Bounds;
	/** The paint order the field's nodes take. */
	z(): number | undefined;
	/** Field coordinates → scene units. */
	toScene(at: Point): Point;
	/** A field vector at `at`, mapped to scene units. */
	toSceneVector(at: Point, vector: Point): Point;
	/** The domain's extent in scene units. */
	sceneSize(): { width: number; height: number };
	/** The sample lattice. */
	lattice(): Lattice;
	/** How many colour bands (and so nodes). */
	bandCount(): number;
	/** One colour per band, low magnitude first. */
	bandColors(): string[];
	/** The band a scene-unit magnitude falls in, for a ramp spanning `[low, high]`. */
	bandIndex(magnitude: number, low: number, high: number): number;
	/** `[low, high]` for the ramp: the caller's window, or `[0, max]`. */
	magnitudeSpan(max: number): [number, number];
	/** The field's on-screen speed at a field-space point (`NaN` where it is not finite). */
	sceneSpeedAt(at: Point): number;
	/** Step size and count for a flow line. */
	flow(virtualTime?: number, steps?: number): { dt: number; steps: number };
}

/** `compute` run once, on first call. */
function lazy<T>(compute: () => T): () => T {
	let done = false;
	let value: T;
	return () => {
		if (!done) {
			value = compute();
			done = true;
		}
		return value;
	};
}

/**
 * Makes the engine for one snapshot of a field's props and surroundings.
 * Everything is computed on first use and kept: make a new engine when the
 * props, the coordinate system, the frame or the theme change.
 *
 * @param props - The field's props.
 * @param environment - See {@link FieldEnvironment}.
 * @returns The engine.
 * @category Coordinate systems & graphs
 */
export function createFieldEngine(
	props: Readonly<FieldProps>,
	environment: FieldEnvironment,
): FieldEngine {
	const { coords, frame, theme } = environment;

	// The visible frame is read only for an axis nothing else defines, and
	// inside the branch that needs it: reading it unconditionally would make a
	// field with explicit ranges (or inside axes) recompute on every pan and
	// zoom for nothing.
	const domain = lazy<Bounds>(() => {
		const x: Range =
			props.xRange ?? (coords ? coords.xRange() : [frame().minX, frame().maxX]);
		const y: Range =
			props.yRange ?? (coords ? coords.yRange() : [frame().minY, frame().maxY]);
		return {
			minX: Math.min(x[0], x[1]),
			maxX: Math.max(x[0], x[1]),
			minY: Math.min(y[0], y[1]),
			maxY: Math.max(y[0], y[1]),
		};
	});

	const toScene = (at: Point): Point =>
		coords ? coords.coordsToPoint(at.x, at.y) : { x: at.x, y: at.y };

	/**
	 * A vector's image in scene units. Taken as a difference of mapped points
	 * rather than by scaling, so a non-linear axis (a log one, say) bends the
	 * vector exactly as it bends the curve drawn through the same place.
	 */
	const toSceneVector = (at: Point, vector: Point): Point => {
		const tail = toScene(at);
		const head = toScene({ x: at.x + vector.x, y: at.y + vector.y });
		return { x: head.x - tail.x, y: head.y - tail.y };
	};

	/** The domain's own extent in scene units — measured, never assumed. */
	const sceneSize = lazy(() => {
		const box = domain();
		const origin = toScene({ x: box.minX, y: box.minY });
		const across = toScene({ x: box.maxX, y: box.minY });
		const up = toScene({ x: box.minX, y: box.maxY });
		return {
			width: Math.hypot(across.x - origin.x, across.y - origin.y),
			height: Math.hypot(up.x - origin.x, up.y - origin.y),
		};
	});

	const lattice = lazy<Lattice>(() => {
		const box = domain();
		const size = sceneSize();
		const columns = Math.max(2, Math.round(props.columns ?? DEFAULT_COLUMNS));
		// Rows follow the *scene* aspect, so the cells come out square-ish however
		// lopsided the two data ranges are.
		const rows =
			size.width > 0 && size.height > 0
				? Math.max(
						2,
						Math.min(
							MAX_PER_AXIS,
							Math.round((columns * size.height) / size.width),
						),
					)
				: columns;

		let xs = tickValues([box.minX, box.maxX], {
			step: props.xStep ?? props.step,
			count: columns,
			limit: MAX_PER_AXIS,
		});
		let ys = tickValues([box.minY, box.maxY], {
			step: props.yStep ?? props.step,
			count: rows,
			limit: MAX_PER_AXIS,
		});

		const stride = Math.ceil(
			Math.sqrt((xs.length * ys.length) / MAX_SAMPLES) || 1,
		);
		xs = everyNth(xs, stride);
		ys = everyNth(ys, stride);

		const spacing = {
			x:
				xs.length > 1
					? (xs[1] as number) - (xs[0] as number)
					: box.maxX - box.minX,
			y:
				ys.length > 1
					? (ys[1] as number) - (ys[0] as number)
					: box.maxY - box.minY,
		};
		// Samples at the cells' centres, between the ticks: off the axis lines
		// (which stand on ticks) and inside the range, so no arrow sits on an
		// axis or reaches past its end.
		const centres = (values: number[]) =>
			values.length > 1
				? values.slice(1).map((value, i) => ((values[i] as number) + value) / 2)
				: values;
		xs = centres(xs);
		ys = centres(ys);

		const points: Point[] = [];
		for (const y of ys) for (const x of xs) points.push({ x, y });

		const spanX = box.maxX - box.minX;
		const spanY = box.maxY - box.minY;
		return {
			points,
			spacing,
			cell: {
				width: spanX > 0 ? (size.width * spacing.x) / spanX : size.width,
				height: spanY > 0 ? (size.height * spacing.y) / spanY : size.height,
			},
		};
	});

	/**
	 * The ramp itself, plus whether it is degenerately a single colour: a
	 * one-entry stop list or a bare `stroke` with no `ramp` at all. A named
	 * colormap or caller function is never single — there is no one "the"
	 * colour to read off a `(t) => string` without sampling it, and sampling
	 * it at an arbitrary `t` would be a silent, surprising choice, so those
	 * always quantise into `DEFAULT_BANDS` (or `props.bands`) nodes.
	 */
	const colormap = lazy<{ ramp: (t: number) => string; single: boolean }>(
		() => {
			const spec = props.ramp;
			if (isStopList(spec) && spec.length > 0) {
				return { ramp: colorRamp(spec), single: spec.length < 2 };
			}
			if (spec !== undefined && !isStopList(spec)) {
				return { ramp: resolveColormap(spec), single: false };
			}
			if (props.stroke !== undefined && !isGradientSpec(props.stroke)) {
				return { ramp: colorRamp([props.stroke as ColorInput]), single: true };
			}
			const palette = theme.palette;
			return {
				ramp: colorRamp([
					palette.series[1] ?? palette.muted,
					palette.series[0] ?? palette.accent,
				]),
				single: false,
			};
		},
	);

	/** One colour means one node; no point quantising a constant. */
	const bandCount = lazy(() =>
		colormap().single
			? 1
			: Math.max(1, Math.round(props.bands ?? DEFAULT_BANDS)),
	);

	const bandColors = lazy(() => {
		const ramp = colormap().ramp;
		const count = bandCount();
		return Array.from({ length: count }, (_, index) =>
			ramp(count === 1 ? 1 : index / (count - 1)),
		);
	});

	const bandIndex = (magnitude: number, low: number, high: number): number => {
		const count = bandCount();
		if (count === 1) return 0;
		if (!(high > low)) return count - 1;
		const t = (magnitude - low) / (high - low);
		return Math.max(0, Math.min(count - 1, Math.floor(t * count)));
	};

	const magnitudeSpan = (max: number): [number, number] =>
		props.magnitudeRange ?? [0, max];

	const sceneSpeedAt = (at: Point): number => {
		const vector = props.function(at);
		if (!isFinitePoint(vector)) return Number.NaN;
		const mapped = toSceneVector(at, vector);
		return Math.hypot(mapped.x, mapped.y);
	};

	/**
	 * Step size and count for a flow line. Without `virtualTime`, the time is
	 * derived from the median sampled speed so lines cross a fair fraction of the
	 * plot at any scale.
	 */
	const flow = (
		virtualTime?: number,
		steps?: number,
	): { dt: number; steps: number } => {
		const count = Math.max(1, Math.round(steps ?? DEFAULT_STREAM_STEPS));
		if (virtualTime !== undefined)
			return { dt: virtualTime / count, steps: count };

		const speeds = lattice()
			.points.map(sceneSpeedAt)
			.filter((speed) => Number.isFinite(speed) && speed > 0)
			.sort((a, b) => a - b);
		if (speeds.length === 0) return { dt: 0, steps: count };

		const median = speeds[speeds.length >> 1] as number;
		const size = sceneSize();
		const distance = DEFAULT_CROSSING * Math.min(size.width, size.height);
		return { dt: distance / median / count, steps: count };
	};

	/**
	 * Inside a coordinate system a field covers the plane, so by default it
	 * paints under the axes and their numbers rather than over them.
	 */
	const z = () => props.zIndex ?? (coords ? UNDER_AXES_Z_INDEX : undefined);

	return {
		domain,
		z,
		toScene,
		toSceneVector,
		sceneSize,
		lattice,
		bandCount,
		bandColors,
		bandIndex,
		magnitudeSpan,
		sceneSpeedAt,
		flow,
	};
}

/** Whether the field's domain falls back to the visible frame on some axis. */
function readsFrame(
	props: Readonly<FieldProps>,
	coords: CoordinateSystem | null,
): boolean {
	return !coords && (props.xRange === undefined || props.yRange === undefined);
}

/** An empty band still holds its node, so the band list's keys stay put. */
function emptyBands(count: number, closed: boolean): ShapeGeometry[] {
	return Array.from({ length: count }, () => ({
		closed,
		curvePaths: [],
		fillFrom: 0,
	}));
}

/* -------------------------------------------------------- field composite */

/** How one kind of field turns an engine into band outlines and paints. */
interface FieldKind<P extends FieldProps> {
	name: string;
	props: PropsDescriptor<P>;
	/** Shape props handed to every band as they are. */
	forwarded: readonly (keyof P)[];
	bands: (props: Readonly<P>, engine: FieldEngine) => ShapeGeometry[];
	/** The band's paints (its `stroke`, and `fill` when the field decides it). */
	paints: (
		props: Readonly<P>,
		engine: FieldEngine,
		index: number,
	) => Partial<Pick<ShapeProps, "stroke" | "fill">>;
}

const handlesByDefinition = new WeakSet<object>();

/** The engine for a field node's current props and surroundings. */
function engineOf(props: Readonly<FieldProps>, node: SceneNode): FieldEngine {
	const coords = node.context(coordsContext);
	const frame = node.context(frameContext);
	const theme = node.context(themeContext);
	return createFieldEngine(props, { coords, frame: () => frame.peek(), theme });
}

function defineField<P extends FieldProps>(
	kind: FieldKind<P>,
): Definition<P, CompositeNode<P>> {
	/** Builds (or rebuilds) the band nodes for the current props and context. */
	const build = (ctx: CompositeContext<P>): SceneNode[] => {
		const props = ctx.props;
		const coords = ctx.context(coordsContext);
		const frame = ctx.context(frameContext);
		const theme = ctx.theme;
		const engine = createFieldEngine(props, {
			coords,
			frame: () => frame.peek(),
			theme,
		});
		const count = engine.bandCount();
		// Bound to the frame only when the domain needs it: then a pan is a new
		// frame value, and the bands follow it with no `update`.
		const bands: Readable<ShapeGeometry[]> = readsFrame(props, coords)
			? derive(frame, (box) =>
					kind.bands(
						props,
						createFieldEngine(props, { coords, frame: () => box, theme }),
					),
				)
			: track(kind.bands(props, engine), { equals: false });
		const apply = (node: ShapeNode<OutlineProps>, index: number) => {
			node.update({
				outline: derive(bands, (all) => all[index] as ShapeGeometry),
				zIndex: engine.z(),
				...kind.paints(props, engine, index),
			});
		};
		return ctx.list(
			"bands",
			Array.from({ length: count }, (_, index) => index),
			{
				create: (index) => {
					const node = outline.create({});
					forwardProps(ctx, node, kind.forwarded);
					apply(node, index);
					return node;
				},
				update: apply,
			},
		);
	};

	const definition = defineComposite<P>({
		name: kind.name,
		props: kind.props,
		setup: build,
		update: (changed: Changes<P>, ctx) => {
			if (needsRebuild(changed)) return build(ctx);
			for (const child of ctx.node.children)
				forwardHandlers(changed, ctx, child);
			return undefined;
		},
	});
	handlesByDefinition.add(definition);
	return definition;
}

/**
 * The {@link VectorFieldHandle} of a `vectorField` or `streamLines` node:
 * `vectorAt` and `streamlineAt` for riding the flow.
 *
 * @example
 * ```ts
 * import { axes, createScene, fieldHandle, vectorField } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * const field = axesNode.add(vectorField.create({ function: (p) => ({ x: -p.y, y: p.x }) }));
 * const flowLine = fieldHandle(field).streamlineAt({ x: 1, y: 0 });
 * ```
 *
 * @param node - A field node.
 * @returns Its handle.
 * @throws For a node that is not a field.
 * @category Coordinate systems & graphs
 */
export function fieldHandle(node: SceneNode): VectorFieldHandle {
	if (!handlesByDefinition.has(node.definition)) {
		throw new TypeError(`fieldHandle: ${node.type} is not a field.`);
	}
	const props = (node as unknown as { props: FieldProps }).props;
	const engine = () => engineOf(props, node);
	return {
		domain: () => engine().domain(),
		toScene: (at) => engine().toScene(at),
		vectorAt: (at) => engine().toSceneVector(at, props.function(at)),
		streamlineAt: (at, options) => {
			const current = engine();
			const { dt, steps } = current.flow(options?.virtualTime, options?.steps);
			const trace = options?.both ? streamlineBothWays : streamline;
			return trace(props.function, at, {
				dt,
				steps,
				bounds: current.domain(),
			}).map(current.toScene);
		},
	};
}

/* ---------------------------------------------------------- vectorField */

/**
 * Props for {@link vectorField}: the {@link FieldProps} plus arrow sizing and tips.
 *
 * @category Coordinate systems & graphs
 */
export interface VectorFieldProps extends FieldProps {
	/**
	 * Scene-unit length of the largest arrow. Defaults to most of one lattice
	 * cell, which is what stops a dense field turning into a hedge.
	 */
	maxLength?: number;
	/**
	 * Arrow length from its magnitude, both in scene units — Manim's
	 * `length_func`. The default is linear against the largest sample, so
	 * relative lengths are honest and the longest arrow is `maxLength`.
	 */
	lengthFunction?: (magnitude: number, largest: number) => number;
	/** Tip outline. `"vee"` — the default — is the original two-stroke head. */
	tipShape?: TipShape;
	/**
	 * Tip extent in scene units. Unlike a lone `arrow`, it defaults to about a
	 * third of each arrow's own length so short arrows keep a proportionate
	 * head; the tip is never longer than its arrow.
	 */
	tipLength?: number;
	/** Colour for a closed tip. Defaults to the band's colour, so it reads solid. */
	tipFill?: ColorInput;
}

/** Arrows as band outlines: shafts first, then heads (`fillFrom` between them). */
function arrowBands(
	props: Readonly<VectorFieldProps>,
	engine: FieldEngine,
): ShapeGeometry[] {
	const shape: TipShape = props.tipShape ?? "vee";
	const arrows: { at: Point; direction: Point; magnitude: number }[] = [];
	let largest = 0;
	for (const point of engine.lattice().points) {
		const vector = props.function(point);
		if (!isFinitePoint(vector)) continue;
		const mapped = engine.toSceneVector(point, vector);
		const magnitude = Math.hypot(mapped.x, mapped.y);
		if (!(magnitude > 0) || !Number.isFinite(magnitude)) continue;
		arrows.push({
			at: engine.toScene(point),
			direction: { x: mapped.x / magnitude, y: mapped.y / magnitude },
			magnitude,
		});
		if (magnitude > largest) largest = magnitude;
	}

	const cell = engine.lattice().cell;
	const longest =
		props.maxLength ?? Math.min(cell.width, cell.height) * DEFAULT_ARROW_FILL;
	const lengthOf =
		props.lengthFunction ??
		((magnitude: number, top: number) =>
			top > 0 ? (longest * magnitude) / top : 0);
	const [low, high] = engine.magnitudeSpan(largest);
	const closed = tipIsClosed(shape);
	const count = engine.bandCount();

	const shaftCurves: CurvePath[][] = Array.from({ length: count }, () => []);
	const headCurves: CurvePath[][] = Array.from({ length: count }, () => []);

	for (const arrow of arrows) {
		const length = lengthOf(arrow.magnitude, largest);
		if (!(length > 0) || !Number.isFinite(length)) continue;
		// Centred on its sample, so it stays inside its own cell.
		const from = {
			x: arrow.at.x - (arrow.direction.x * length) / 2,
			y: arrow.at.y - (arrow.direction.y * length) / 2,
		};
		const to = {
			x: arrow.at.x + (arrow.direction.x * length) / 2,
			y: arrow.at.y + (arrow.direction.y * length) / 2,
		};
		const index = engine.bandIndex(arrow.magnitude, low, high);
		shaftCurves[index]?.push(polylineToCurvePath([from, to], false));
		// The head is a share of *this* arrow, not a fixed extent: a field's
		// arrows differ in length by design, and a constant tip would swallow
		// the short ones whole.
		const tipLength = Math.min(length, props.tipLength ?? length * TIP_RATIO);
		const head = tipPolylines(
			shape,
			to,
			Math.atan2(arrow.direction.y, arrow.direction.x),
			tipLength,
		);
		headCurves[index]?.push(...head.curvePaths);
	}

	return shaftCurves.map((curves, index) => ({
		closed,
		curvePaths: [...curves, ...(headCurves[index] ?? [])],
		// Shafts are structure, heads are area — see `ShapeGeometry.fillFrom`.
		fillFrom: curves.length,
	}));
}

/** Shape props a field hands to its bands as they are. */
const FIELD_FORWARDED = (keys: readonly (keyof ShapeProps)[]) =>
	(Object.keys(shapeProps) as (keyof ShapeProps)[]).filter(
		(key) => !keys.includes(key),
	);

/**
 * A lattice of arrows (Manim's `ArrowVectorField`). `function` maps a point to
 * a vector, in data units inside an `axes` or scene units outside one.
 * Arrows are scaled against the largest and coloured by on-screen magnitude
 * through `ramp`; a zero vector draws nothing. Samples sit at the lattice
 * cells' centres, between the ticks, each arrow centred on its sample, so
 * every arrow stays inside its own cell, clear of the axes. Without a coordinate system or
 * `xRange`/`yRange` the lattice covers the visible frame, so it re-samples as
 * the view moves. One node per colour band.
 *
 * @example
 * ```ts
 * import { axes, createScene, vectorField } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * axesNode.add(vectorField.create({ function: (p) => ({ x: -p.y, y: p.x }), ramp: "viridis" }));
 * ```
 *
 * @see {@link streamLines}
 * @see {@link https://sophistry.dev/guides/fields-and-graphs/#vector-fields}
 * @category Coordinate systems & graphs
 */
export const vectorField = defineField<VectorFieldProps>({
	name: "VectorField",
	props: {
		...forwardedProps(shapeProps),
		...fieldOwnProps,
		fill: { invalidates: Invalidate.UPDATE },
		maxLength: { invalidates: Invalidate.UPDATE },
		lengthFunction: { invalidates: Invalidate.UPDATE },
		tipShape: { default: "vee", invalidates: Invalidate.UPDATE },
		tipLength: { invalidates: Invalidate.UPDATE },
		tipFill: { invalidates: Invalidate.UPDATE },
	},
	forwarded: FIELD_FORWARDED(["stroke", "fill", "zIndex"]),
	bands: arrowBands,
	paints: (props, engine, index) => {
		const color = engine.bandColors()[index] as string;
		const filled = tipIsClosed(props.tipShape ?? "vee");
		return {
			stroke: color,
			fill: filled
				? ((props.tipFill as PaintSpec | undefined) ?? color)
				: props.fill,
		};
	},
});

/* ----------------------------------------------------------- streamLines */

/**
 * Props for {@link streamLines}: the {@link FieldProps} plus integration controls.
 *
 * @category Coordinate systems & graphs
 */
export interface StreamLinesProps extends FieldProps {
	/**
	 * How long each particle flows for, in field time units. Defaults to roughly what lets a
	 * typical particle cross about half the plot.
	 */
	virtualTime?: number;
	/**
	 * Integration steps per line, and so its anchor count.
	 * @default 60
	 */
	steps?: number;
	/**
	 * Seed scatter, as a share of the lattice spacing. Deterministic; 0 is exact.
	 * @default 0.4
	 */
	noise?: number;
	/** Explicit seeds in field coordinates, instead of the jittered lattice. */
	seeds?: Point[];
	/**
	 * Which way to integrate. `"both"` hides the seeds.
	 * @default `"forward"`
	 */
	direction?: "forward" | "backward" | "both";
	/** Speed (field units) at which a particle counts as stopped, ending its line. */
	minSpeed?: number;
	/**
	 * Colour each line by the magnitude along it, rather than one colour per line
	 * from its seed. A `progress` reveal then draws colour by colour.
	 * @default false
	 */
	colorAlong?: boolean;
}

/** The seeds: the caller's, or the lattice jittered by `noise`. */
function seedsOf(
	props: Readonly<StreamLinesProps>,
	engine: FieldEngine,
): Point[] {
	if (props.seeds) return props.seeds;
	const { points, spacing } = engine.lattice();
	const noise = props.noise ?? DEFAULT_NOISE;
	if (noise === 0) return points;
	return points.map((point, index) => ({
		x: point.x + fieldJitter(index, 1) * noise * spacing.x,
		y: point.y + fieldJitter(index, 2) * noise * spacing.y,
	}));
}

/** Flow lines grouped into bands, cut where `colorAlong` changes band. */
function streamBands(
	props: Readonly<StreamLinesProps>,
	engine: FieldEngine,
): ShapeGeometry[] {
	const count = engine.bandCount();
	const { dt, steps } = engine.flow(props.virtualTime, props.steps);
	if (dt === 0 || !Number.isFinite(dt)) return emptyBands(count, false);

	const bounds = engine.domain();
	const backward = props.direction === "backward";
	const trace = props.direction === "both" ? streamlineBothWays : streamline;

	const along = props.colorAlong === true;
	// One magnitude per line, or one per anchor when the line is graded.
	const lines: { points: Polyline; magnitudes: number[] }[] = [];
	let largest = 0;
	for (const seed of seedsOf(props, engine)) {
		const vector = props.function(seed);
		if (!isFinitePoint(vector)) continue;
		const mapped = engine.toSceneVector(seed, vector);
		const magnitude = Math.hypot(mapped.x, mapped.y);
		if (!Number.isFinite(magnitude)) continue;

		const path = trace(props.function, seed, {
			dt,
			steps,
			bounds,
			backward,
			minSpeed: props.minSpeed,
		});
		if (path.length < 2) continue;
		// A non-finite speed mid-line is a singularity the integrator walked
		// close to; it reads as zero rather than poisoning the band index.
		const magnitudes = along
			? path.map((at) => {
					const speed = engine.sceneSpeedAt(at);
					return Number.isFinite(speed) ? speed : 0;
				})
			: [magnitude];
		for (const value of magnitudes) if (value > largest) largest = value;
		lines.push({ points: path.map(engine.toScene), magnitudes });
	}

	const [low, high] = engine.magnitudeSpan(largest);
	const grouped: Polyline[][] = Array.from({ length: count }, () => []);
	for (const { points, magnitudes } of lines) {
		if (magnitudes.length < 2) {
			grouped[engine.bandIndex(magnitudes[0] as number, low, high)]?.push(
				points,
			);
			continue;
		}
		// Cut where the band changes. The vertex at the cut goes into *both*
		// pieces, so the two abut instead of leaving a gap the width of one
		// integration step.
		let start = 0;
		let band = engine.bandIndex(magnitudes[0] as number, low, high);
		for (let i = 1; i < points.length; i++) {
			const next = engine.bandIndex(magnitudes[i] as number, low, high);
			if (next === band) continue;
			grouped[band]?.push(points.slice(start, i + 1));
			start = i;
			band = next;
		}
		grouped[band]?.push(points.slice(start));
	}
	return grouped.map((polylines) => ({ polylines, closed: false }));
}

/**
 * Flow lines through a field (Manim's `StreamLines`), integrated with RK4 from
 * a deterministically jittered lattice of seeds. Each line takes the colour at
 * its seed unless `colorAlong`; animate `dashOffset` against a `dash` for flow
 * that moves. Lines stop at the sampled region's edge. One node per colour
 * band.
 *
 * @example
 * ```ts
 * import { axes, createScene, streamLines } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * axesNode.add(streamLines.create({ function: (p) => ({ x: p.y, y: -p.x }), colorAlong: true }));
 * ```
 *
 * @see {@link vectorField}
 * @see {@link https://sophistry.dev/guides/fields-and-graphs/#vector-fields}
 * @category Coordinate systems & graphs
 */
export const streamLines = defineField<StreamLinesProps>({
	name: "StreamLines",
	props: {
		...forwardedProps(shapeProps),
		...fieldOwnProps,
		virtualTime: { invalidates: Invalidate.UPDATE },
		steps: { default: DEFAULT_STREAM_STEPS, invalidates: Invalidate.UPDATE },
		noise: { default: DEFAULT_NOISE, invalidates: Invalidate.UPDATE },
		seeds: { invalidates: Invalidate.UPDATE },
		direction: { default: "forward", invalidates: Invalidate.UPDATE },
		minSpeed: { invalidates: Invalidate.UPDATE },
		colorAlong: { default: false, invalidates: Invalidate.UPDATE },
	},
	forwarded: FIELD_FORWARDED(["stroke", "zIndex"]),
	bands: streamBands,
	paints: (_props, engine, index) => ({
		stroke: engine.bandColors()[index] as string,
	}),
});
