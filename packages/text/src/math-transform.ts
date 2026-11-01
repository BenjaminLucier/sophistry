/**
 * `mathTransform`: Manim's `TransformMatchingTex`, as a composite.
 *
 * The correspondence and the interpolation live in `morph.ts`; this is the
 * part that turns a sampled transform into scene nodes. One `path` per part,
 * kept by index across the whole run (`ctx.list`): the plan's list is the same length and the same
 * order at every blend, which is what lets the renderer keep its arc-length
 * caches instead of rebuilding a few hundred nodes per frame. Transform props
 * apply to a wrapping `group`.
 *
 * Pending and errors work as on `mathTex` (see `math-tex.ts`), over two
 * formulas: nothing is drawn until both are typeset, and a changed pair keeps
 * the old morph up until every new formula has landed.
 */

import type {
	Changes,
	CompositeContext,
	CompositeOptions,
	CreateArguments,
	CreateProps,
	Definition,
	InvalidateBits,
	PaintSpec,
	Placement,
	PropDescriptor,
	PropsDescriptor,
	Readable,
	SceneNode,
} from "@sophistry/core";
import { group, Invalidate, path } from "@sophistry/core";
import type { Point, Polyline } from "@sophistry/core/geometry";
import { CompositeNode, rawProp } from "@sophistry/core/internal";
import type { LatexHandle, LatexOptions, LatexStatus } from "./latex.js";
import {
	disposedError,
	LatexReadables,
	LatexSource,
	ReadyWaiters,
} from "./latex.js";
import type { LatexMorph, LatexMorphOptions, MorphedPart } from "./morph.js";
import { morphLatex } from "./morph.js";
import type { PlacedLatex } from "./placed.js";

/**
 * Props for {@link mathTransform}: the two formulas, the blend, and paint,
 * dash and transform props.
 *
 * @category Components
 */
export interface MathTransformProps extends LatexOptions, LatexMorphOptions {
	/** TeX source of the starting formula. */
	from: string;
	/** TeX source of the ending formula. */
	to: string;
	/**
	 * Blend from `from` to `to`, 0..1 (clamped). 0 is exactly `from`, 1 is
	 * exactly `to`. Animate it with a bound `track` (`valueTo`, a spring).
	 *
	 * @default 0
	 */
	blend?: number;
	/** Fill for every part. Defaults to the theme foreground. */
	fill?: PaintSpec;
	/** Outline paint. Defaults to the part's fill colour. */
	stroke?: PaintSpec;
	/**
	 * Outline width. By default glyphs are fill alone, as in a finished `mathTex`.
	 * @default 0
	 */
	strokeWidth?: number;
	/**
	 * Opacity of the whole formula, 0..1; multiplied with each part's own
	 * cross-fade opacity.
	 *
	 * @default 1
	 */
	opacity?: number;
	/**
	 * Colour a part by what the transform did to it: see `MorphedPart.role`.
	 * Return `undefined` to fall back to `fill`.
	 */
	partFill?: (part: MorphedPart, index: number) => PaintSpec | undefined;
	/**
	 * Opacity of the fills alone, 0..1, on top of `opacity`.
	 * @default 1
	 */
	fillOpacity?: number;
	/** Dash pattern for the outlines in scene units, as on any shape. Solid by default. */
	dash?: number[];
	/**
	 * Where in the `dash` pattern the outlines start.
	 * @default 0
	 */
	dashOffset?: number;
	/**
	 * How outline ends are capped.
	 * @default `"round"`
	 */
	lineCap?: CanvasLineCap;
	/**
	 * How outline corners are joined.
	 * @default `"round"`
	 */
	lineJoin?: CanvasLineJoin;
	/** Rotation of the whole formula about `origin`, in radians; positive is counter-clockwise. */
	rotation?: number;
	/**
	 * Uniform scale of the whole formula about `origin`.
	 * @default 1
	 */
	scale?: number;
	/**
	 * Pivot for `rotation` and `scale`, in formula-local scene units (before
	 * `x`/`y`). Defaults to the formula's centre, so every part turns together.
	 */
	origin?: Point;
	/** A placement from the layout helpers (`nextTo`, ...); adds to `x`/`y`. */
	place?: Placement;
	/** Horizontal position of the formula's centre, in scene units. */
	x?: number;
	/** Vertical position of the formula's centre, in scene units (y-up). */
	y?: number;
	/**
	 * Paint order; higher draws later.
	 * @default 0
	 */
	zIndex?: number;
	/**
	 * Set false to hide the formula.
	 * @default true
	 */
	visible?: boolean;
}

/** Part props bound straight to the composite's (as set). */
const boundPartKeys = [
	"fillOpacity",
	"dash",
	"dashOffset",
	"lineCap",
	"lineJoin",
	"zIndex",
	"visible",
] as const;
/** The props whose change means a new typesetting request. */
const TYPESET_KEYS = new Set<PropertyKey>([
	"from",
	"to",
	"displayMode",
	"macros",
]);

const mathTransformProps = {
	from: { default: "", invalidates: Invalidate.UPDATE },
	to: { default: "", invalidates: Invalidate.UPDATE },
	fontSize: { default: 1, invalidates: Invalidate.UPDATE },
	displayMode: { default: true, invalidates: Invalidate.UPDATE },
	macros: { invalidates: Invalidate.UPDATE },
	keyMap: { invalidates: Invalidate.UPDATE },
	mismatch: { default: "fade", invalidates: Invalidate.UPDATE },
	blend: { default: 0, invalidates: Invalidate.UPDATE },
	fill: { invalidates: Invalidate.UPDATE },
	stroke: { invalidates: Invalidate.UPDATE },
	strokeWidth: { default: 0, invalidates: Invalidate.UPDATE },
	opacity: { default: 1, invalidates: Invalidate.UPDATE },
	partFill: { invalidates: Invalidate.UPDATE },
	fillOpacity: { default: 1, invalidates: Invalidate.NONE },
	dash: { invalidates: Invalidate.NONE },
	dashOffset: { default: 0, invalidates: Invalidate.NONE },
	lineCap: { default: "round", invalidates: Invalidate.NONE },
	lineJoin: { default: "round", invalidates: Invalidate.NONE },
	rotation: { default: 0, invalidates: Invalidate.NONE },
	scale: { default: 1, invalidates: Invalidate.NONE },
	origin: { invalidates: Invalidate.NONE },
	place: { invalidates: Invalidate.NONE },
	x: { default: 0, invalidates: Invalidate.NONE },
	y: { default: 0, invalidates: Invalidate.NONE },
	zIndex: { default: 0, invalidates: Invalidate.NONE },
	visible: { default: true, invalidates: Invalidate.NONE },
	onError: { kind: "event", invalidates: Invalidate.NONE },
} as PropsDescriptor<MathTransformProps>;

type PathNode = ReturnType<typeof path.create>;
type GroupNode = ReturnType<typeof group.create>;

/** Whether two outlines have the same points (a part that did not move). */
function samePolylines(
	a: readonly Polyline[],
	b: readonly Polyline[],
): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const lineA = a[i] as Polyline;
		const lineB = b[i] as Polyline;
		if (lineA.length !== lineB.length) return false;
		for (let j = 0; j < lineA.length; j++) {
			const pointA = lineA[j] as Point;
			const pointB = lineB[j] as Point;
			if (pointA.x !== pointB.x || pointA.y !== pointB.y) return false;
		}
	}
	return true;
}

/**
 * The {@link mathTransform} node: a composite of one path per morphed part,
 * and the transform's loading handle.
 *
 * @category Components
 */
export class MathTransformNode
	extends CompositeNode<MathTransformProps>
	implements LatexHandle
{
	readonly status: Readable<LatexStatus>;
	private readonly fromLatex: LatexSource;
	private readonly toLatex: LatexSource;
	private readonly readables = new LatexReadables();
	private readonly waiters = new ReadyWaiters();
	private composite: CompositeContext<MathTransformProps> | null = null;
	private wrapper: GroupNode | null = null;
	private placedStale = false;
	private typesetStale = true;
	private running = false;
	private uncaught: { error: unknown } | null = null;
	/** The pair the shown morph was planned from; kept while a new pair typesets. */
	private shown: { from: PlacedLatex; to: PlacedLatex } | null = null;
	private planCache: {
		from: PlacedLatex;
		to: PlacedLatex;
		keyMap: MathTransformProps["keyMap"];
		mismatch: MathTransformProps["mismatch"];
		plan: LatexMorph;
	} | null = null;

	constructor(
		definition: Definition<MathTransformProps>,
		options: CompositeOptions<MathTransformProps>,
	) {
		super(definition, options);
		this.fromLatex = new LatexSource(() => this.latexChanged());
		this.toLatex = new LatexSource(() => this.latexChanged());
		this.status = this.readables.view(() => this.currentStatus());
	}

	/* ------------------------------------------------------------ handle */

	/** True while either formula is being typeset. */
	pending(): boolean {
		return this.currentStatus() === "pending";
	}

	/** The failure of either formula, or undefined. */
	error(): unknown {
		return this.fromLatex.error() ?? this.toLatex.error();
	}

	/** Resolves once both formulas are typeset (see `MathTexNode.ready`). */
	ready(): Promise<void> {
		if (this.disposed) return Promise.reject(disposedError());
		const status = this.currentStatus();
		if (status === "ready") return Promise.resolve();
		if (status === "failed") return Promise.reject(this.error());
		return this.waiters.wait();
	}

	/** The parts at the current blend (none until both formulas are typeset). */
	morphedParts(): readonly MorphedPart[] {
		const plan = this.plan();
		return plan ? plan(this.props.blend ?? 0) : [];
	}

	/* ------------------------------------------------------------ stages */

	protected override propChanged<K extends keyof MathTransformProps>(
		key: K,
		descriptor: PropDescriptor<MathTransformProps[K]>,
	): void {
		if (TYPESET_KEYS.has(key) && !this.typesetStale) {
			this.typesetStale = true;
			this.readables.notify();
		}
		super.propChanged(key, descriptor);
	}

	protected override run(dirty: InvalidateBits): void {
		this.running = true;
		try {
			super.run(dirty);
			if (this.placedStale && this.composite) this.build(this.composite);
		} finally {
			this.running = false;
		}
		this.settleWaiters();
		const uncaught = this.uncaught;
		if (uncaught) {
			this.uncaught = null;
			throw uncaught.error;
		}
	}

	protected override disposeContents(): void {
		super.disposeContents();
		this.fromLatex.dispose();
		this.toLatex.dispose();
		this.waiters.dispose();
		this.composite = null;
	}

	/** @internal `setup`: the wrapping group, the first requests and parts. */
	setupTree(
		context: CompositeContext<MathTransformProps>,
	): readonly SceneNode[] {
		this.composite = context;
		const wrapper = group.create({
			place: rawProp(context, "place"),
			x: rawProp(context, "x"),
			y: rawProp(context, "y"),
			rotation: rawProp(context, "rotation"),
			scale: rawProp(context, "scale"),
			origin: rawProp(context, "origin"),
		});
		this.wrapper = wrapper;
		this.typeset();
		this.build(context);
		return [wrapper];
	}

	/** @internal `update`: new requests, and the parts for the current blend. */
	updateTree(
		changed: Changes<MathTransformProps>,
		context: CompositeContext<MathTransformProps>,
	): undefined {
		if (changed.has("fontSize") || this.typesetStale) this.typeset();
		this.build(context);
		return undefined;
	}

	/* ----------------------------------------------------------- private */

	private currentStatus(): LatexStatus {
		if (this.composite === null || this.typesetStale) return "pending";
		const from = this.fromLatex.status();
		const to = this.toLatex.status();
		if (from === "failed" || to === "failed") return "failed";
		if (from === "pending" || to === "pending") return "pending";
		return "ready";
	}

	private typeset(): void {
		const props = this.props;
		this.typesetStale = false;
		const options: LatexOptions = {
			displayMode: props.displayMode,
			macros: props.macros,
			fontSize: props.fontSize,
			onError: (error, tex) => this.props.onError?.(error, tex),
		};
		this.fromLatex.typeset(props.from ?? "", options);
		this.toLatex.typeset(props.to ?? "", options);
	}

	private latexChanged(): void {
		this.placedStale = true;
		if (this.currentStatus() === "failed" && !this.props.onError) {
			this.uncaught = { error: this.error() };
		}
		if (!this.running) this.invalidate(Invalidate.UPDATE);
		this.readables.notify();
		this.settleWaiters();
	}

	private settleWaiters(): void {
		if (this.waiters.size === 0) return;
		const status = this.currentStatus();
		if (status === "ready") this.waiters.settle();
		else if (status === "failed") this.waiters.settle({ error: this.error() });
	}

	/**
	 * The morph plan for the pair on show. The pair only moves on once
	 * neither formula is typesetting, so a changed pair holds the old morph
	 * whole rather than mixing a new formula with an old one; a failure
	 * clears it. Rebuilt only when a formula or a matching rule changes,
	 * never on `blend`.
	 */
	private plan(): LatexMorph | null {
		const status = this.currentStatus();
		if (status === "failed") this.shown = null;
		else if (status === "ready") {
			const from = this.fromLatex.placed();
			const to = this.toLatex.placed();
			this.shown = from && to ? { from, to } : null;
		}
		const shown = this.shown;
		if (!shown) return null;
		const { keyMap, mismatch } = this.props;
		const last = this.planCache;
		if (
			last &&
			last.from === shown.from &&
			last.to === shown.to &&
			last.keyMap === keyMap &&
			last.mismatch === mismatch
		) {
			return last.plan;
		}
		const plan = morphLatex(shown.from, shown.to, { keyMap, mismatch });
		this.planCache = { ...shown, keyMap, mismatch, plan };
		return plan;
	}

	/** Sets the wrapper's paths for the current blend, one per part, kept by index. */
	private build(context: CompositeContext<MathTransformProps>): void {
		this.placedStale = false;
		const wrapper = this.wrapper;
		if (!wrapper) return;
		const parts = this.morphedParts();
		wrapper.setChildren(
			context.list<MorphedPart, PathNode>("parts", parts, {
				key: (_part, index) => index,
				create: (part, index) => {
					const node = path.create({ closed: true });
					for (const key of boundPartKeys) {
						node.set(key, rawProp(context, key) as Readable<never>);
					}
					return this.updatePart(context, node, part, index);
				},
				update: (node, part, index) => {
					this.updatePart(context, node, part, index);
				},
			}),
		);
	}

	private updatePart(
		context: CompositeContext<MathTransformProps>,
		node: PathNode,
		part: MorphedPart,
		index: number,
	): PathNode {
		const props = this.props;
		const paint =
			props.partFill?.(part, index) ??
			props.fill ??
			context.theme.palette.foreground;
		// A part that does not move between the two formulas samples to the
		// same outline at every blend; keeping the old array keeps its path
		// (and the geometry baked from it) from rebuilding per tick.
		const previous = node.get("points") as Polyline[] | undefined;
		return node.update({
			points:
				previous && samePolylines(previous, part.polylines)
					? previous
					: part.polylines,
			fill: paint,
			stroke: props.stroke ?? paint,
			strokeWidth: props.strokeWidth ?? 0,
			opacity: (props.opacity ?? 1) * part.opacity,
		});
	}
}

const mathTransformOptions: CompositeOptions<MathTransformProps> = {
	name: "MathTransform",
	props: mathTransformProps,
	setup: (context) =>
		(context.node as unknown as MathTransformNode).setupTree(context),
	update: (changed, context) =>
		(context.node as unknown as MathTransformNode).updateTree(changed, context),
};

/**
 * Morphs one TeX formula into another (Manim's `TransformMatchingTex`):
 * shared glyphs travel, the rest fade. Drive `blend` (0 to 1) with a bound
 * `track`. Nothing is drawn until both formulas are typeset, and a changed
 * pair keeps the old morph up until the new one is ready; scripts await
 * `node.ready()`. `keyMap` forces correspondences; `mismatch: "morph"`
 * reshapes leftovers. No `strokeAlong` or pointer props.
 *
 * @example
 * ```ts
 * import { createScene, track, valueTo } from "@sophistry/core";
 * import { mathTransform } from "@sophistry/text";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 8 });
 * const blend = track(0);
 * const morph = scene.add(mathTransform.create({ from: "a^2 + b^2", to: "c^2", blend }));
 * await morph.ready();
 * await scene.play(valueTo(blend, 1, { duration: 2 }));
 * ```
 *
 * @see {@link https://sophistry.dev/guides/math-and-latex/#transforming-formulas}
 * @see {@link morphLatex}
 * @category Components
 */
export const mathTransform: Definition<MathTransformProps, MathTransformNode> =
	Object.freeze({
		kind: "composite",
		name: "MathTransform",
		descriptor: mathTransformProps,
		container: false,
		create: (...args: CreateArguments<MathTransformProps>) =>
			new MathTransformNode(mathTransform, mathTransformOptions).init(
				args[0] as CreateProps<MathTransformProps> | undefined,
			),
	});
