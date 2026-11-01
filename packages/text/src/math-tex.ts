/**
 * `mathTex`: a TeX formula as scene geometry. CSS lays the formula out
 * (`measure.ts`) and the contours come from KaTeX's own fonts (`outline.ts`),
 * so a formula reveals by arc length, takes gradients and morphs like any
 * shape.
 *
 * It is a composite that owns
 * the typesetting (a `LatexSource`) and builds its outline nodes from the
 * placed formula: one `MathTexOutline` shape for the whole formula (a plain single shape), or one per part when `partFill` colours parts
 * differently. The handle is the node itself: `pending()`, `ready()`,
 * `placed()`, `parts()`, `partBounds(index)`, `status`.
 *
 * ## Pending and errors
 *
 * Typesetting starts at the node's first commit and again in the commit
 * after `tex`, `displayMode` or `macros` change. Until the first formula
 * lands the node draws nothing (its siblings draw as usual); while a later
 * one typesets, the previous formula stays up. A formula already typeset
 * elsewhere (the outline cache shares one request per formula) is taken in
 * the same commit. A failure clears the formula and is reported to
 * `onError`; without `onError` it is rethrown from the next commit, as an
 * async shape geometry's rejection is. Either way `ready()` rejects with it
 * and `error()` returns it, and a new `tex` recovers.
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
	PropDescriptor,
	PropsDescriptor,
	Readable,
	SceneNode,
	ShapeInstanceable,
	ShapeNode,
	ShapeProps,
} from "@sophistry/core";
import {
	defineShape,
	derive,
	Invalidate,
	readDelta,
	shapeProps,
	writeLagRatio,
} from "@sophistry/core";
import type { Bounds, Polyline } from "@sophistry/core/geometry";
import { boundsOf, centerOf, compose } from "@sophistry/core/geometry";
import {
	bakeLocalTransform,
	bakePolylines,
	CompositeNode,
	forwardedProps,
	forwardHandlers,
	forwardProps,
	rawProp,
} from "@sophistry/core/internal";
import type { LatexHandle, LatexOptions, LatexStatus } from "./latex.js";
import {
	disposedError,
	LatexReadables,
	LatexSource,
	ReadyWaiters,
} from "./latex.js";
import { OUTLINE_RATIO } from "./outline-stroke.js";
import type { PlacedLatex, PlacedPart } from "./placed.js";

/**
 * Per-part paint for {@link mathTex} (Manim's `tex_to_color_map`): a
 * function of the part and its index, or a record from a glyph's source
 * character to its paint (`{ x: "gold", y: "tomato" }`). Parts it gives no
 * paint (`undefined`, or a character not in the record; rules and stretchy
 * pieces have no character) take `fill`.
 *
 * @category Components
 */
export type PartFill =
	| ((part: PlacedPart, index: number) => PaintSpec | undefined)
	| Readonly<Record<string, PaintSpec>>;

/**
 * Props for {@link mathTex}: any shape prop, plus the formula and its
 * typesetting options.
 *
 * @category Components
 */
export interface MathTexProps extends ShapeProps, LatexOptions {
	/** TeX source, as KaTeX understands it (e.g. `"\\frac{a}{b}"` in a JS string). */
	tex: string;
	/**
	 * Colours parts individually; see {@link PartFill}. With it the formula is
	 * one shape node per part instead of one for the whole (gradients then
	 * span each part, not the formula), and `progress` still writes it as a
	 * whole.
	 */
	partFill?: PartFill;
	/** Called with the placed parts whenever the placed formula changes (a new formula, or a new `fontSize`). */
	onTypeset?: (placed: PlacedLatex) => void;
}

/** The props of the outline shape: shape props plus the parts it draws. */
interface MathTexOutlineProps extends ShapeProps {
	/** The parts, placed in scene units, y up. */
	parts?: readonly PlacedPart[];
	/** The formula's size, for the width of the outline being written. */
	fontSize?: number;
}

const NONE: Polyline[] = [];

/**
 * The formula's own shape: every part's contours in one node, written the
 * way Manim writes a `MathTex`: `progress` runs over the parts with a lag,
 * each tracing its outline and then filling in. Fill alone when finished,
 * as Manim's `MathTex` (`stroke_width=0`): a stroke on a glyph only thickens
 * it. What {@link mathTex} puts in its subtree.
 *
 * @internal
 */
export const mathTexOutline = defineShape<
	MathTexOutlineProps,
	ShapeInstanceable
>({
	name: "MathTexOutline",
	props: {
		...shapeProps,
		parts: { invalidates: Invalidate.GEOMETRY },
		fontSize: { default: 1, invalidates: Invalidate.GEOMETRY },
	},
	geometry: (props) => {
		const parts = props.parts ?? [];
		const pieces: number[] = [];
		let start = 0;
		for (const part of parts) {
			pieces.push(start);
			start += part.polylines.length;
		}
		return {
			polylines:
				parts.length > 0 ? parts.flatMap((part) => part.polylines) : NONE,
			closed: true,
			write: {
				pieces,
				outlineWidth: (props.fontSize ?? 1) * OUTLINE_RATIO,
			},
		};
	},
	styleProps: (props, theme) => ({
		...props,
		fill: props.fill ?? theme.palette.foreground,
		strokeWidth: props.strokeWidth ?? 0,
	}),
});

type OutlineNode = ShapeNode<MathTexOutlineProps>;

/** The outline props the composite binds its shapes to. */
const forwarded = forwardedProps<MathTexOutlineProps, "parts" | "fontSize">(
	mathTexOutline.descriptor,
	["parts", "fontSize"],
);
const forwardedKeys = Object.keys(forwarded) as (keyof MathTexProps)[];
/** Forwarded keys a per-part shape takes from the composite as derived values instead. */
const perPartKeys = new Set<keyof MathTexProps>(["progress", "origin"]);
const perPartForwardedKeys = forwardedKeys.filter(
	(key) => !perPartKeys.has(key),
);

/** The props whose change means a new typesetting request. */
const TYPESET_KEYS = new Set<PropertyKey>(["tex", "displayMode", "macros"]);

const mathTexProps = {
	...forwarded,
	tex: { default: "", invalidates: Invalidate.UPDATE },
	fontSize: { default: 1, invalidates: Invalidate.UPDATE },
	displayMode: { default: true, invalidates: Invalidate.UPDATE },
	macros: { invalidates: Invalidate.UPDATE },
	partFill: { invalidates: Invalidate.UPDATE },
	onError: { kind: "event", invalidates: Invalidate.NONE },
	onTypeset: { kind: "event", invalidates: Invalidate.NONE },
} as PropsDescriptor<MathTexProps>;

/** A part's own paint under `partFill`, or undefined for the formula's `fill`. */
function paintOf(
	partFill: PartFill,
	part: PlacedPart,
	index: number,
): PaintSpec | undefined {
	if (typeof partFill === "function") return partFill(part, index);
	return part.char === undefined ? undefined : partFill[part.char];
}

/**
 * Where part `index` of `count` stands in an overall write at `progress`:
 * its own window of Manim's lagged `Write` (see `writePhase`), so one node per
 * part, each written alone, moves exactly as the parts of one node do.
 */
function partProgress(progress: number, index: number, count: number): number {
	const lagRatio = writeLagRatio(count);
	const span = (count - 1) * lagRatio + 1;
	return Math.min(1, Math.max(0, progress * span - index * lagRatio));
}

/**
 * The {@link mathTex} node: a composite whose subtree is the formula's
 * outline, and the formula's handle.
 *
 * @category Components
 */
export class MathTexNode
	extends CompositeNode<MathTexProps>
	implements LatexHandle
{
	readonly status: Readable<LatexStatus>;
	private readonly latex: LatexSource;
	private readonly readables = new LatexReadables();
	private readonly waiters = new ReadyWaiters();
	private composite: CompositeContext<MathTexProps> | null = null;
	/** The placed formula changed since the children were built. */
	private placedStale = false;
	/** A typesetting prop was written since the last request. */
	private typesetStale = true;
	private running = false;
	/** A failure with no `onError` to contain it: rethrown from the next commit. */
	private uncaught: { error: unknown } | null = null;
	private lastTypeset: PlacedLatex | null = null;
	/** All the placed parts' contours, for the default pivot of `partBounds`. */
	private flatCache: { placed: PlacedLatex; lines: Polyline[] } | null = null;

	constructor(
		definition: Definition<MathTexProps>,
		options: CompositeOptions<MathTexProps>,
	) {
		super(definition, options);
		this.latex = new LatexSource(() => this.latexChanged());
		this.status = this.readables.view(() => this.currentStatus());
	}

	/* ------------------------------------------------------------ handle */

	pending(): boolean {
		return this.currentStatus() === "pending";
	}

	error(): unknown {
		return this.latex.error();
	}

	/**
	 * Resolves once the formula for the current props is typeset: a `tex`
	 * written just before is waited for (typesetting starts at the node's
	 * next commit, so a node never added to a scene waits until it is).
	 * Rejects if typesetting fails, and with an `AbortError` if the node is
	 * disposed first.
	 */
	ready(): Promise<void> {
		if (this.disposed) return Promise.reject(disposedError());
		if (!this.awaitingCommit()) {
			const status = this.latex.status();
			if (status === "ready") return Promise.resolve();
			if (status === "failed") return Promise.reject(this.latex.error());
		}
		return this.waiters.wait();
	}

	/** The placed formula (centred on the origin, scene units, y up), or null before it lands. */
	placed(): PlacedLatex | null {
		return this.latex.placed();
	}

	/** The placed parts in reading order (none before the formula lands). */
	parts(): readonly PlacedPart[] {
		return this.latex.placed()?.parts ?? [];
	}

	/**
	 * Part `index`'s box in scene units, after the formula's transform and the
	 * enclosing space (what `bounds()` is for the whole formula): to point a
	 * brace or an arrow at one glyph. Null for a part that does not exist.
	 */
	partBounds(index: number): Bounds | null {
		this.refresh();
		const placed = this.latex.placed();
		const part = placed?.parts[index];
		if (!placed || !part) return null;
		const props = this.props;
		const local = bakeLocalTransform(props, readDelta(props.place), () =>
			this.flatPolylines(placed),
		);
		const space = this.space.matrix;
		const matrix = local ? compose(space, local) : space;
		return boundsOf(bakePolylines(part.polylines, matrix));
	}

	/* ------------------------------------------------------------ stages */

	protected override propChanged<K extends keyof MathTexProps>(
		key: K,
		descriptor: PropDescriptor<MathTexProps[K]>,
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
			if (this.placedStale && this.composite) {
				this.setChildren(this.build(this.composite));
			}
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
		this.latex.dispose();
		this.waiters.dispose();
		this.composite = null;
	}

	/** @internal `setup`: the first request and the first children. */
	setupTree(context: CompositeContext<MathTexProps>): readonly SceneNode[] {
		this.composite = context;
		this.typeset();
		return this.build(context);
	}

	/** @internal `update`: a new request, handlers, and children for what changed. */
	updateTree(
		changed: Changes<MathTexProps>,
		context: CompositeContext<MathTexProps>,
	): readonly SceneNode[] | undefined {
		if (changed.has("fontSize") || this.typesetStale) this.typeset();
		const rebuilt =
			this.placedStale || changed.has("partFill")
				? this.build(context)
				: undefined;
		for (const child of rebuilt ?? this.children) {
			forwardHandlers(changed, context, child);
		}
		return rebuilt;
	}

	/* ----------------------------------------------------------- private */

	/** Status as the handle reports it: pending while a request is still to be made. */
	private currentStatus(): LatexStatus {
		return this.awaitingCommit() ? "pending" : this.latex.status();
	}

	/** Whether the next commit may start a new request (not set up, or a typesetting prop written). */
	private awaitingCommit(): boolean {
		return this.composite === null || this.typesetStale;
	}

	private typeset(): void {
		const props = this.props;
		this.typesetStale = false;
		this.latex.typeset(props.tex ?? "", {
			displayMode: props.displayMode,
			macros: props.macros,
			fontSize: props.fontSize,
			onError: (error, tex) => this.props.onError?.(error, tex),
		});
	}

	/** The source told us the placed formula or the status changed. */
	private latexChanged(): void {
		this.placedStale = true;
		if (this.latex.status() === "failed" && !this.props.onError) {
			this.uncaught = { error: this.latex.error() };
		}
		if (!this.running) this.invalidate(Invalidate.UPDATE);
		this.readables.notify();
		const placed = this.latex.placed();
		if (placed && placed !== this.lastTypeset) {
			this.lastTypeset = placed;
			this.props.onTypeset?.(placed);
		}
		this.settleWaiters();
	}

	/** Settles `ready()` waiters once the current props' formula has landed or failed. */
	private settleWaiters(): void {
		if (this.waiters.size === 0 || this.awaitingCommit()) return;
		const status = this.latex.status();
		if (status === "ready") this.waiters.settle();
		else if (status === "failed") {
			this.waiters.settle({ error: this.latex.error() });
		}
	}

	private flatPolylines(placed: PlacedLatex): Polyline[] {
		if (this.flatCache?.placed !== placed) {
			this.flatCache = {
				placed,
				lines: placed.parts.flatMap((part) => part.polylines),
			};
		}
		return this.flatCache.lines;
	}

	/**
	 * The outline nodes for the placed formula: none before it lands, one
	 * shape for the whole formula, or with `partFill` one per part.
	 */
	private build(context: CompositeContext<MathTexProps>): SceneNode[] {
		this.placedStale = false;
		const props = this.props;
		const placed = this.latex.placed();
		const partFill = props.partFill;
		const whole = placed && !partFill ? [placed] : [];
		const parts = placed && partFill ? placed.parts : [];

		const wholeNodes = context.list<PlacedLatex, OutlineNode>("whole", whole, {
			key: () => "whole",
			create: (current) => {
				const node = mathTexOutline.create();
				forwardProps(context, node, forwardedKeys);
				return node.update({
					parts: current.parts,
					fontSize: props.fontSize,
				});
			},
			update: (node, current) => {
				node.update({ parts: current.parts, fontSize: props.fontSize });
			},
		});
		if (!placed || !partFill) return wholeNodes;

		// One shape per part. Each writes alone over its window of the whole
		// write, and pivots about the formula's centre, so the parts move as
		// the single shape would.
		const count = parts.length;
		const center = centerOf(boundsOf(this.flatPolylines(placed)));
		const progress = rawProp(context, "progress");
		const origin = derive(
			rawProp(context, "origin"),
			(value) => value ?? center,
		);
		return context.list<PlacedPart, OutlineNode>("parts", parts, {
			key: (_part, index) => index,
			create: (part, index) => {
				const node = mathTexOutline.create();
				forwardProps(context, node, perPartForwardedKeys);
				return this.updatePart(node, part, index, count, progress, origin);
			},
			update: (node, part, index) => {
				this.updatePart(node, part, index, count, progress, origin);
			},
		});
	}

	private updatePart(
		node: OutlineNode,
		part: PlacedPart,
		index: number,
		count: number,
		progress: Readable<number | undefined>,
		origin: Readable<MathTexProps["origin"]>,
	): OutlineNode {
		const props = this.props;
		const paint = props.partFill
			? paintOf(props.partFill, part, index)
			: undefined;
		return node.update({
			parts: [part],
			fontSize: props.fontSize,
			fill:
				paint ??
				rawProp(this.composite as CompositeContext<MathTexProps>, "fill"),
			progress: derive(progress, (value) =>
				partProgress(value ?? 1, index, count),
			),
			origin,
		});
	}
}

const mathTexOptions: CompositeOptions<MathTexProps> = {
	name: "MathTex",
	props: mathTexProps,
	setup: (context) =>
		(context.node as unknown as MathTexNode).setupTree(context),
	update: (changed, context) =>
		(context.node as unknown as MathTexNode).updateTree(changed, context),
};

/**
 * Renders a TeX formula, centred on its position. `progress` writes it glyph
 * by glyph as Manim's `Write` does, so `draw(node)` is `Write`. A finished
 * formula is fill alone (theme foreground by default); `partFill` colours
 * parts individually (Manim's `tex_to_color_map`). Typesetting is async: the
 * rest of the scene paints at once, the formula appears when it lands, and
 * scripts should `await node.ready()` before animating. The node is the
 * handle: `pending()`, `ready()`, `error()`, `status`, `placed()`, `parts()`,
 * `partBounds(index)`, plus every node handle (`bounds()`, ...). See the
 * module doc for pending and error behaviour. Use `label` for prose.
 *
 * @see {@link https://sophistry.dev/guides/math-and-latex/}
 * @see {@link mathTransform}
 *
 * @example
 * ```ts
 * import { createScene, draw, track } from "@sophistry/core";
 * import { mathTex } from "@sophistry/text";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 8 });
 * const drawn = track(0);
 * const formula = scene.add(
 * 	mathTex.create({ tex: "e^{i\\pi} + 1 = 0", fontSize: 1.4, progress: drawn }),
 * );
 * await formula.ready();
 * await scene.play(draw(drawn, { duration: 3 }));
 * ```
 *
 * @category Components
 */
export const mathTex: Definition<MathTexProps, MathTexNode> = Object.freeze({
	kind: "composite",
	name: "MathTex",
	descriptor: mathTexProps,
	container: false,
	create: (...args: CreateArguments<MathTexProps>) =>
		new MathTexNode(mathTex, mathTexOptions).init(
			args[0] as CreateProps<MathTexProps> | undefined,
		),
});
