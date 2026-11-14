/**
 * The text node kind: text positioned in scene units and styled by the
 * active theme, publishing a `TextSpec`. `defineText` makes a text
 * definition from a function giving the content (`text` passes its `text`
 * prop through; a number display formats a value), and `text` is the plain
 * one. One plain line is drawn as a single run; spans, newlines or a width
 * lay the content out into a block of fragments.
 *
 * Stages: `GEOMETRY` re-reads the string; `STYLE` rebuilds the text style
 * (font, colour, halo; it folds in the enclosing groups' scale and opacity);
 * `TRANSFORM` and `SPEC` reassemble the spec through last-input caches. The
 * handle's box comes from the text metrics oracle, oriented for the scene's
 * `yUp` as the glyphs are drawn, and is re-measured once a web font loads.
 */

import type { ColorInput } from "../color/index.js";
import { cssColor } from "../color/index.js";
import type { Bounds, Point, Polyline } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import {
	applyToPoint,
	compose,
	fromTranslationRotationScale,
	scaleFactorOf,
	scale as scaleMatrix,
	translate,
} from "../geometry/transform.js";
import type { InteractionProps } from "../interact/types.js";
import type {
	PlacedInline,
	TextBlockInline,
	TextBlockRun,
	TextHalo,
	TextStyleInput,
} from "../spec/bake.js";
import { bakeTextBlock, bakeTextSpec, bakeTextStyle } from "../spec/bake.js";
import type { Placement } from "../spec/layout.js";
import { readDelta } from "../spec/layout.js";
import { fontLoads, labelBox } from "../spec/metrics.js";
import { layoutText } from "../spec/text-layout.js";
import type {
	ClipRegion,
	TextFragment,
	TextSpec,
	TextStyle,
} from "../spec/types.js";
import { BaseContainer } from "./container.js";
import type { LengthUnit } from "./context.js";
import {
	createContextKey,
	Invalidate,
	lengthScaleOf,
	pixelsPerUnitContext,
	themeContext,
} from "./context.js";
import { fontEpochContext, watchFontLoads } from "./fonts.js";
import type { SceneGraph } from "./graph.js";
import { interactionProps } from "./interaction-props.js";
import { ANY_CONTEXT, BaseNode, memo } from "./node.js";
import { definePrimitive } from "./primitive.js";
import { lastMatrix } from "./shape.js";
import type {
	ContextKey,
	Definition,
	InvalidateBits,
	PropsDescriptor,
	SceneNode,
	Space,
} from "./types.js";
import { SpaceChange } from "./types.js";

export type { TextHalo } from "../spec/bake.js";

/**
 * A run of text with its own style. Anything it leaves out comes from the
 * text node's props.
 *
 * @category Text & numbers
 */
export interface TextSpan {
	text: string;
	/** Font size in the node's units. */
	fontSize?: number;
	color?: ColorInput;
	fontFamily?: string;
	fontWeight?: string | number;
	italic?: boolean;
	letterSpacing?: number;
	/** Multiplied with the node's opacity. */
	opacity?: number;
	/** A line under the run, in its colour. */
	underline?: boolean;
	/** A line through the run, in its colour. */
	strikethrough?: boolean;
	/** A colour behind the run. */
	highlight?: ColorInput;
}

/**
 * A scene node set into a line of text like one wide glyph: a formula in a
 * sentence, a dot in a legend. It keeps scene units (scaled with the text's
 * group), lines break around it as around a word, and its line grows to hold
 * it. The text owns it: dropped from the text, it is disposed.
 *
 * @category Text & numbers
 */
export interface TextInline {
	inline: SceneNode;
	/**
	 * How far above the node's bottom edge the text's baseline crosses it,
	 * in the node's units. Omitted, the node is centred on the text, a
	 * little above the baseline.
	 */
	baseline?: number;
}

/**
 * What a text node draws: a string, or strings, {@link TextSpan}s and
 * {@link TextInline} nodes in reading order. `"\n"` starts a new line.
 *
 * @category Text & numbers
 */
export type RichText = string | readonly (string | TextSpan | TextInline)[];

/** Where an inline node is centred when it gives no baseline, in ems above the baseline. */
const INLINE_MIDDLE = 0.3;

function isInline(part: string | TextSpan | TextInline): part is TextInline {
	return typeof part !== "string" && "inline" in part;
}

/**
 * Text style a container hands down to the text inside it (a box's text
 * properties). A text node's own props win; what it leaves unset comes from
 * here, then from the theme.
 *
 * @category Text & numbers
 */
export interface InheritedTextStyle {
	color?: ColorInput;
	fontSize?: number;
	fontFamily?: string;
	fontWeight?: string | number;
	italic?: boolean;
	letterSpacing?: number;
	lineHeight?: number;
	textAlign?: CanvasTextAlign;
	underline?: boolean;
	strikethrough?: boolean;
}

/**
 * The {@link InheritedTextStyle} for a subtree, or null where nothing hands
 * one down.
 *
 * @category Text & numbers
 */
export const textStyleContext: ContextKey<InheritedTextStyle | null> =
	createContextKey<InheritedTextStyle | null>("textStyle", null);

/**
 * Props every text node accepts, besides what gives it its string.
 *
 * @category Text & numbers
 */
export interface TextProps extends InteractionProps {
	/**
	 * Where a placement function put this text: the one prop a `Placement`
	 * fits, and how captions take part in layout. Adds to `x`/`y`.
	 */
	place?: Placement;
	/**
	 * Anchor x.
	 * @default 0
	 */
	x?: number;
	/**
	 * Anchor y in scene units (up is positive on a y-up stage).
	 * @default 0
	 */
	y?: number;
	/** Font size in scene units (not pixels). Defaults to the theme's font size. */
	fontSize?: number;
	/**
	 * Text colour: a CSS string or a `Color` such as `BLUE`. Defaults to the
	 * theme foreground. Text takes a single `color`, not `fill`/`stroke`.
	 */
	color?: ColorInput;
	/** CSS font family. Defaults to the theme's. */
	fontFamily?: string;
	/**
	 * CSS font weight.
	 * @default 500
	 */
	fontWeight?: string | number;
	/**
	 * Italic text.
	 * @default false
	 */
	italic?: boolean;
	/**
	 * Horizontal alignment of the text relative to the anchor.
	 * @default `"center"`
	 */
	align?: CanvasTextAlign;
	/**
	 * Vertical alignment of the text relative to the anchor.
	 * @default `"middle"`
	 */
	baseline?: CanvasTextBaseline;
	/** Radians, about the anchor; positive is counter-clockwise on a y-up stage. */
	rotation?: number;
	/**
	 * Extra space between characters.
	 * @default 0
	 */
	letterSpacing?: number;
	/**
	 * What the text's sizes (`fontSize`, `letterSpacing`, `width`) are
	 * measured in: `"scene"` for scene units, `"px"` for design pixels (a
	 * scene is 1920 wide). Its `x`/`y` stay in the parent's units. Omitted,
	 * the text uses its surroundings' unit.
	 */
	lengthUnit?: LengthUnit;
	/**
	 * Wrap lines at this width, in the node's units. Omitted, only newlines
	 * break. `align` places the block on the anchor and each line within it.
	 */
	width?: number;
	/**
	 * Where lines sit within a multi-line block. Defaults to `align`, so a
	 * left-anchored block is left-aligned; a centred block of left-aligned
	 * lines takes `align: "center", textAlign: "left"`.
	 */
	textAlign?: CanvasTextAlign;
	/**
	 * Line height, as a multiple of the largest font size on each line.
	 * @default 1.3
	 */
	lineHeight?: number;
	/** A line under the text, in its colour. */
	underline?: boolean;
	/** A line through the text, in its colour. */
	strikethrough?: boolean;
	/**
	 * Opacity 0..1, multiplied with enclosing groups.
	 * @default 1
	 */
	opacity?: number;
	/**
	 * An outline in the background colour around the glyphs, so the text
	 * reads over whatever is under it: `true` for the defaults, or a
	 * {@link TextHalo}. Defaults to none.
	 */
	halo?: boolean | TextHalo;
	/**
	 * Left-to-right reveal, 0..1: written glyph by glyph, each glyph fading in
	 * whole, since Canvas2D can't trim a glyph outline (and a glyph cut
	 * partway would read as another letter).
	 */
	progress?: number;
	/**
	 * Paint order; higher draws later.
	 * @default 0
	 */
	zIndex?: number;
	/**
	 * `false` hides the text.
	 * @default true
	 */
	visible?: boolean;
}

/**
 * Descriptor entries for every {@link TextProps} key.
 *
 * @category Text & numbers
 */
export const textProps: PropsDescriptor<TextProps> = Object.freeze({
	...interactionProps,
	place: { invalidates: Invalidate.TRANSFORM },
	x: { default: 0, invalidates: Invalidate.TRANSFORM, instanceable: true },
	y: { default: 0, invalidates: Invalidate.TRANSFORM, instanceable: true },
	rotation: {
		default: 0,
		invalidates: Invalidate.TRANSFORM,
		instanceable: true,
	},
	fontSize: { invalidates: Invalidate.STYLE, instanceable: true },
	color: { invalidates: Invalidate.STYLE, instanceable: true },
	fontFamily: { invalidates: Invalidate.STYLE },
	fontWeight: { default: 500, invalidates: Invalidate.STYLE },
	italic: { default: false, invalidates: Invalidate.STYLE },
	align: { default: "center", invalidates: Invalidate.STYLE },
	baseline: { default: "middle", invalidates: Invalidate.STYLE },
	letterSpacing: {
		default: 0,
		invalidates: Invalidate.STYLE,
		instanceable: true,
	},
	lengthUnit: { invalidates: Invalidate.STYLE },
	width: { invalidates: Invalidate.GEOMETRY },
	textAlign: { invalidates: Invalidate.GEOMETRY },
	lineHeight: { default: 1.3, invalidates: Invalidate.GEOMETRY },
	opacity: { default: 1, invalidates: Invalidate.STYLE, instanceable: true },
	halo: { invalidates: Invalidate.STYLE },
	underline: { invalidates: Invalidate.GEOMETRY },
	strikethrough: { invalidates: Invalidate.GEOMETRY },
	progress: { default: 1, invalidates: Invalidate.SPEC, instanceable: true },
	zIndex: { default: 0, invalidates: Invalidate.SPEC },
	visible: { default: true, invalidates: Invalidate.SPEC },
});

/**
 * Options for {@link defineText}.
 *
 * @typeParam P - The text node's props.
 *
 * @category Text & numbers
 */
export interface TextOptions<P extends TextProps> {
	/** PascalCase display and codegen name (`"Text"`). */
	name: string;
	/** One entry per prop: `...textProps` plus the definition's own. */
	props: PropsDescriptor<P>;
	/**
	 * What to draw, from the props it reads: a string, or strings and spans
	 * ({@link RichText}); empty draws nothing. Reruns when a prop
	 * invalidating `Invalidate.GEOMETRY` changes.
	 */
	text: (props: Readonly<P>) => RichText;
}

/** Every run's text together. */
function plainText(content: RichText): string {
	if (typeof content === "string") return content;
	return content
		.map((part) =>
			typeof part === "string" ? part : isInline(part) ? "" : part.text,
		)
		.join("");
}

/** A box's four corners, divided by `perUnit`. */
function boxCorners(box: Bounds, perUnit = 1): Polyline {
	const minX = box.minX / perUnit;
	const minY = box.minY / perUnit;
	const maxX = box.maxX / perUnit;
	const maxY = box.maxY / perUnit;
	return [
		{ x: minX, y: minY },
		{ x: maxX, y: minY },
		{ x: maxX, y: maxY },
		{ x: minX, y: maxY },
	];
}

/**
 * A text node. Made by a {@link defineText} definition's `create`.
 *
 * @typeParam P - The node's props.
 *
 * @category Text & numbers
 */
export class TextNode<
	P extends TextProps = TextProps,
> extends BaseContainer<P> {
	override readonly producesSpec = true;

	private readonly options: TextOptions<P>;
	/** What to draw, or null when a geometry prop changed since it was read. */
	private content: RichText | null = null;
	/**
	 * Scene units: the enclosing groups' scale is folded in, the camera's is
	 * not (the renderer multiplies by the view's scale at paint time). Lazy: a
	 * hidden text node restyles nothing.
	 */
	private style: TextStyle | null = null;
	/** The groups' scale the style was built for. */
	private styleScale = Number.NaN;

	private readonly anchorOf = memo(
		(matrix: Matrix, x: number, y: number): Point =>
			applyToPoint(matrix, { x, y }),
	);
	private readonly plainOf = memo(plainText);
	/** The laid-out block, for rich, multi-line or wrapped text. */
	private readonly blockOf = memo(
		(
			content: RichText,
			style: TextStyle,
			width: number | undefined,
			lineHeight: number | undefined,
			textAlign: CanvasTextAlign | undefined,
			pixelsPerUnit: number,
			_fontEpoch: number,
			_decorations: string,
			_inlineEpoch: number,
		): TextBlock =>
			bakeTextBlock(this.runsOf(content, style), {
				width,
				lineHeight,
				textAlign,
				pixelsPerUnit,
				align: style.align,
				baseline: style.baseline,
			}),
	);
	private readonly specOf = memo(
		(
			text: string,
			at: Point,
			rotation: number | undefined,
			matrix: Matrix,
			style: TextStyle,
			progress: number | undefined,
			zIndex: number | undefined,
			clip: readonly ClipRegion[] | undefined,
			block: TextBlock | undefined,
		): TextSpec | null =>
			bakeTextSpec({
				id: this.id,
				zIndex,
				text,
				at,
				// Scene-space baseline angle: the `rotation` prop plus any enclosing
				// group's rotation. The renderer maps it through the view (which is
				// where the y flip, and so the canvas sign, comes in).
				rotation,
				matrix,
				style,
				progress,
				clip,
				block,
			}),
	);
	private readonly boxOf = memo(
		(
			text: string,
			style: TextStyle,
			block: { box: Bounds } | undefined,
			yUp: boolean,
			perUnit: number,
			_fontEpoch: number,
		): Polyline[] => {
			let box: Bounds;
			if (!block) box = labelBox(text, style, yUp);
			else if (yUp) box = block.box;
			else box = { ...block.box, minY: -block.box.maxY, maxY: -block.box.minY };
			return [boxCorners(box, perUnit)];
		},
	);
	private readonly handleMatrixOf = lastMatrix();

	/**
	 * The width a container laying this text out gave it: undefined when no
	 * container does, null for no wrapping. Set, the text is a block hung
	 * from its anchor at the top left, lines aligned by `textAlign`.
	 */
	private layoutWidth: number | null | undefined = undefined;
	/** Inline nodes' boxes in their own units, as last measured. */
	private inlineBounds = new Map<BaseNode, Bounds | null>();
	/** Bumped when an inline node's box changes, so the block lays out again. */
	private inlineEpoch = 0;
	/** The space each inline node was handed, as of the last placement. */
	private inlineSpaces = new Map<BaseNode, Space>();

	constructor(definition: Definition<P>, options: TextOptions<P>) {
		super(definition);
		this.options = options;
	}

	/**
	 * @internal For a container laying this text out (a box): wrap at
	 * `width` (local units; null for no wrapping) and hang the block from the
	 * anchor at its top-left corner. `undefined` hands the text back to its
	 * own props.
	 */
	setLayoutWidth(width: number | null | undefined): void {
		if (width === this.layoutWidth) return;
		// Being laid out or not changes the anchoring (a style); a new width
		// only re-wraps.
		const anchoring =
			(width === undefined) !== (this.layoutWidth === undefined);
		this.layoutWidth = width;
		this.invalidate(
			anchoring ? Invalidate.GEOMETRY | Invalidate.STYLE : Invalidate.GEOMETRY,
		);
	}

	/**
	 * @internal The block's size when wrapped at `width` (local units;
	 * omitted, only newlines break): the longest line's width and every
	 * line's height together, in local units.
	 */
	measure(width?: number): { width: number; height: number } {
		const { scale } = this.units();
		if (!(scale > 0)) return { width: 0, height: 0 };
		const style = this.currentStyle();
		const layout = layoutText(
			this.runsOf(this.currentContent(), style).map((run) =>
				"inline" in run ? run : { text: run.text, font: run.style },
			),
			{
				width: width === undefined ? undefined : width * scale,
				lineHeight: this.lineHeight(),
				pixelsPerUnit: this.context(pixelsPerUnitContext),
			},
		);
		return {
			width: layout.contentWidth / scale,
			height: layout.height / scale,
		};
	}

	/** The line height: the node's, else an inherited one. */
	private lineHeight(): number | undefined {
		return this.props.lineHeight ?? this.context(textStyleContext)?.lineHeight;
	}

	/* ------------------------------------------------------------ stages */

	protected override run(dirty: InvalidateBits): void {
		const content = this.content;
		const style = this.style;
		if (dirty & Invalidate.GEOMETRY) this.content = null;
		if (dirty & Invalidate.STYLE) this.style = null;
		const spec = this.assemble();
		this.publish(spec);
		if (this.childNodes.length > 0) this.placeInline(spec);
		// A container laying this text out sizes it from its content and style.
		if (
			this.layoutWidth !== undefined &&
			(this.content !== content || this.style !== style)
		) {
			this.parentNode?.childContentChanged(this);
		}
	}

	protected override stagesForSpace(change: number): InvalidateBits {
		let bits = 0;
		// The spec folds in the groups' matrix; the style their scale, which
		// it checks for itself, so a group's move keeps the style.
		if (change & SpaceChange.MATRIX) bits |= Invalidate.TRANSFORM;
		if (change & (SpaceChange.OPACITY | SpaceChange.LENGTH_SCALE)) {
			bits |= Invalidate.STYLE;
		}
		if (change & SpaceChange.CLIP) bits |= Invalidate.SPEC;
		// Only the handle's box is oriented by `yUp`; it re-measures on read.
		if (change & SpaceChange.Y_UP) bits |= Invalidate.GEOMETRY;
		return bits;
	}

	protected override stagesForContext(
		key: ContextKey<unknown>,
	): InvalidateBits {
		if (key === themeContext) return Invalidate.STYLE;
		if (key === ANY_CONTEXT || key === textStyleContext) {
			return Invalidate.STYLE | Invalidate.GEOMETRY;
		}
		if (key === pixelsPerUnitContext) {
			// Text is measured at its size in design pixels.
			return this.props.lengthUnit === undefined
				? Invalidate.GEOMETRY
				: Invalidate.STYLE | Invalidate.GEOMETRY;
		}
		// A web font loaded: the handle's box re-measures (it is keyed on the
		// font epoch), and anything measuring through `text` reruns.
		return key === fontEpochContext ? Invalidate.GEOMETRY : 0;
	}

	/** Joining a graph starts its font-load subscription (once per graph). */
	override attach(graph: SceneGraph): void {
		super.attach(graph);
		if (!graph.fontWatch) watchFontLoads(graph);
	}

	private assemble(): TextSpec | null {
		const props = this.props;
		if (props.visible === false) return null;
		const matrix = this.space.matrix;
		const anchor = this.anchor();
		return this.specOf(
			this.currentText(),
			this.anchorOf(matrix, anchor.x, anchor.y),
			props.rotation,
			matrix,
			this.currentStyle(),
			props.progress,
			props.zIndex,
			this.space.clip,
			this.currentBlock(),
		);
	}

	private currentContent(): RichText {
		if (this.content === null) {
			this.content = this.options.text(this.props);
			this.adoptInline(this.content);
		}
		return this.content;
	}

	/** Makes the inline nodes in `content` this node's children. */
	private adoptInline(content: RichText): void {
		const nodes: SceneNode[] =
			typeof content === "string"
				? []
				: content.filter(isInline).map((part) => part.inline);
		if (nodes.length === 0 && this.childNodes.length === 0) return;
		super.setChildren(nodes);
		for (const node of [...this.inlineBounds.keys()]) {
			if (node.parentNode !== this) {
				this.inlineBounds.delete(node);
				this.inlineSpaces.delete(node);
			}
		}
	}

	/** The plain text: every run's text together. */
	private currentText(): string {
		return this.plainOf(this.currentContent());
	}

	/**
	 * The laid-out block, or undefined for one plain line (no spans, no
	 * newline, no width), which is drawn and measured as a single run.
	 */
	private currentBlock(): TextBlock | undefined {
		const content = this.currentContent();
		const laidOut = this.layoutWidth !== undefined;
		const width = laidOut ? (this.layoutWidth ?? undefined) : this.props.width;
		const inherited = this.context(textStyleContext);
		const decorated =
			(this.props.underline ?? inherited?.underline) ||
			(this.props.strikethrough ?? inherited?.strikethrough);
		if (
			!laidOut &&
			!decorated &&
			typeof content === "string" &&
			width === undefined &&
			!content.includes("\n")
		) {
			return undefined;
		}
		const { scale } = this.units();
		return this.blockOf(
			content,
			this.currentStyle(),
			width === undefined ? undefined : width * scale,
			this.lineHeight(),
			this.props.textAlign ?? inherited?.textAlign,
			this.context(pixelsPerUnitContext),
			fontLoads.peek(),
			// The runs read these; a change keeps the content's identity.
			`${this.props.underline ?? inherited?.underline},${this.props.strikethrough ?? inherited?.strikethrough}`,
			this.inlineEpoch,
		);
	}

	/** The runs of `content`, each span's style baked over the node's. */
	private runsOf(
		content: RichText,
		base: TextStyle,
	): (TextBlockRun | TextBlockInline)[] {
		const inherited = this.context(textStyleContext);
		const underline = this.props.underline ?? inherited?.underline;
		const strikethrough = this.props.strikethrough ?? inherited?.strikethrough;
		const plain = (text: string): TextBlockRun => {
			const run: TextBlockRun = { text, style: base };
			if (underline) run.underline = true;
			if (strikethrough) run.strikethrough = true;
			return run;
		};
		if (typeof content === "string") return [plain(content)];
		const input = this.styleInput();
		const theme = this.context(themeContext);
		const space = this.space;
		const { scale, lengthScale } = this.units();
		return content.map((part): TextBlockRun | TextBlockInline => {
			if (typeof part === "string") return plain(part);
			if (isInline(part)) return this.inlineRun(part, base);
			const style = bakeTextStyle(
				{
					...input,
					fill: part.color ?? input.fill,
					fontSize: part.fontSize ?? input.fontSize,
					fontFamily: part.fontFamily ?? input.fontFamily,
					fontWeight: part.fontWeight ?? input.fontWeight,
					italic: part.italic ?? input.italic,
					letterSpacing: part.letterSpacing ?? input.letterSpacing,
					opacity: (input.opacity ?? 1) * (part.opacity ?? 1),
				},
				theme,
				scale,
				space.opacity,
				lengthScale,
			);
			const run: TextBlockRun = { text: part.text, style };
			if (part.underline ?? underline) run.underline = true;
			if (part.strikethrough ?? strikethrough) run.strikethrough = true;
			if (part.highlight !== undefined)
				run.highlight = cssColor(part.highlight);
			return run;
		});
	}

	/* ------------------------------------------------------ inline nodes */

	/** Scene units per unit of an inline node: the text's groups' scale, its own unit aside. */
	private inlineScale(): number {
		const space = this.space;
		return scaleFactorOf(space.matrix) / (space.lengthScale || 1);
	}

	/** Where the text's baseline crosses an inline node, up from its bottom, in its units. */
	private inlineBaseline(
		part: TextInline,
		bounds: Bounds,
		base: TextStyle,
	): number {
		if (part.baseline !== undefined) return part.baseline;
		const own = (part.inline as BaseNode).textBaseline();
		if (own !== null) {
			return this.space.yUp ? own - bounds.minY : bounds.maxY - own;
		}
		const height = bounds.maxY - bounds.minY;
		return height / 2 - (INLINE_MIDDLE * base.fontSize) / this.inlineScale();
	}

	/** The room an inline node takes in its line, in scene units. */
	private inlineRun(part: TextInline, base: TextStyle): TextBlockInline {
		const node = part.inline as BaseNode;
		const bounds = node.ownBounds();
		this.inlineBounds.set(node, bounds);
		if (!bounds) return { inline: { width: 0, ascent: 0, descent: 0 } };
		const scale = this.inlineScale();
		const height = (bounds.maxY - bounds.minY) * scale;
		const descent = this.inlineBaseline(part, bounds, base) * scale;
		return {
			inline: {
				width: (bounds.maxX - bounds.minX) * scale,
				ascent: height - descent,
				descent,
			},
		};
	}

	/** Hands each inline node the space that puts it where the block placed it. */
	private placeInline(spec: TextSpec | null): void {
		const content = this.currentContent();
		const block = this.currentBlock();
		const space = this.space;
		const scale = this.inlineScale();
		const base = this.currentStyle();
		const flip = space.yUp ? 1 : -1;
		const parts = typeof content === "string" ? [] : content;
		const placed = new Map<BaseNode, PlacedInline>();
		for (const inline of block?.inlines ?? []) {
			const part = parts[inline.run];
			if (part && isInline(part)) placed.set(part.inline as BaseNode, inline);
		}
		for (const child of this.childNodes) {
			const at = placed.get(child);
			const bounds = this.inlineBounds.get(child) ?? null;
			let matrix = space.matrix;
			if (at && bounds && spec) {
				const part = parts[at.run] as TextInline;
				const baseline = this.inlineBaseline(part, bounds, base);
				const onBaseline = space.yUp
					? bounds.minY + baseline
					: bounds.maxY - baseline;
				matrix = compose(
					fromTranslationRotationScale({
						x: spec.at.x,
						y: spec.at.y,
						rotation: spec.rotation,
					}),
					compose(
						translate(at.at.x, flip * at.at.y),
						compose(scaleMatrix(scale), translate(-bounds.minX, -onBaseline)),
					),
				);
			}
			const next: Space = {
				matrix,
				opacity: spec && at ? space.opacity * (this.props.opacity ?? 1) : 0,
				clip: space.clip,
				penScale:
					space.penScale === undefined
						? undefined
						: (space.penScale * scale * (space.lengthScale || 1)) /
							(scaleFactorOf(space.matrix) || 1),
				yUp: space.yUp,
				lengthScale: 1,
			};
			const before = this.inlineSpaces.get(child);
			const change = spaceChange(before, next);
			if (change === 0) continue;
			this.inlineSpaces.set(child, next);
			child.spaceChanged(change);
		}
	}

	override childSpaceFor(child: BaseNode): Space {
		return this.inlineSpaces.get(child) ?? this.space;
	}

	/** Inline nodes are sized by their boxes, so the text hears them change. */
	override get watchesChildGeometry(): boolean {
		return true;
	}

	/** An inline node's box changed: lay the block out again. */
	override childGeometryChanged(child: BaseNode): void {
		if (child.parentNode !== this || !this.inlineBounds.has(child)) return;
		const before = this.inlineBounds.get(child) ?? null;
		if (sameBounds(before, child.ownBounds())) return;
		this.inlineEpoch++;
		this.invalidate(Invalidate.GEOMETRY);
		if (this.layoutWidth !== undefined) {
			this.parentNode?.childContentChanged(this);
		}
	}

	/** The node's own style props, as the baker takes them. */
	private styleInput(): TextStyleInput {
		const props = this.props;
		const inherited = this.context(textStyleContext);
		// Laid out by a container, the block hangs from its top-left corner.
		const laidOut = this.layoutWidth !== undefined;
		return {
			fill: props.color ?? inherited?.color,
			fontSize: props.fontSize ?? inherited?.fontSize,
			fontFamily: props.fontFamily ?? inherited?.fontFamily,
			fontWeight: props.fontWeight ?? inherited?.fontWeight,
			italic: props.italic ?? inherited?.italic,
			align: laidOut ? "left" : props.align,
			baseline: laidOut ? "top" : props.baseline,
			opacity: props.opacity,
			letterSpacing: props.letterSpacing ?? inherited?.letterSpacing,
			halo: props.halo,
		};
	}

	/**
	 * Scene units per authored size: the groups' scale times the text's own
	 * `lengthUnit`, if it has one, and the length scale its theme defaults
	 * are divided by.
	 */
	private units(): { scale: number; lengthScale: number } {
		const space = this.space;
		const groups = scaleFactorOf(space.matrix);
		const unit = this.props.lengthUnit;
		if (unit === undefined)
			return { scale: groups, lengthScale: space.lengthScale };
		const lengthScale = lengthScaleOf(unit, this.context(pixelsPerUnitContext));
		return { scale: (groups * lengthScale) / space.lengthScale, lengthScale };
	}

	private currentStyle(): TextStyle {
		const { scale, lengthScale } = this.units();
		if (this.style && scale === this.styleScale) return this.style;
		this.styleScale = scale;
		this.style = bakeTextStyle(
			this.styleInput(),
			this.context(themeContext),
			scale,
			this.space.opacity,
			lengthScale,
		);
		return this.style;
	}

	/** The anchor in local units, `place` folded into `x`/`y`. */
	private anchor(): Point {
		const props = this.props;
		const delta = readDelta(props.place);
		return { x: (props.x ?? 0) + delta.x, y: (props.y ?? 0) + delta.y };
	}

	/* ----------------------------------------------------------- handles */

	/**
	 * The measured box in *local* units, anchored at the origin: the style is
	 * in the enclosing groups' scene units, so dividing by the space's scale
	 * lands back where `x`/`y` live. Oriented for the scene's `yUp`, as the
	 * glyphs are drawn; re-measured after a web font loads.
	 */
	protected override localOutline(): readonly Polyline[] | null {
		const space = this.space;
		return this.boxOf(
			this.currentText(),
			this.currentStyle(),
			this.currentBlock(),
			space.yUp,
			scaleFactorOf(space.matrix) || 1,
			fontLoads.peek(),
		);
	}

	/**
	 * Rotation is about the anchor, so the box rotates about its own origin
	 * before being translated into place; the handle is the rotated box.
	 */
	protected override localMatrix(): Matrix | null {
		const anchor = this.anchor();
		return this.handleMatrixOf(
			fromTranslationRotationScale({
				x: anchor.x,
				y: anchor.y,
				rotation: this.props.rotation,
			}),
		);
	}

	/** The measured box, as for any drawn node (inline nodes are inside it). */
	override bounds(): Bounds | null {
		return BaseNode.prototype.bounds.call(this);
	}

	override localBounds(): Bounds | null {
		return BaseNode.prototype.localBounds.call(this);
	}
}

/** A laid-out block: its fragments, its box, and where it put inline nodes. */
interface TextBlock {
	fragments: TextFragment[];
	box: Bounds;
	inlines: PlacedInline[];
}

/** Which parts of a space changed. */
function spaceChange(previous: Space | undefined, next: Space): number {
	if (!previous) return SpaceChange.ALL;
	const a = previous.matrix;
	const b = next.matrix;
	let change = 0;
	if (
		a.a !== b.a ||
		a.b !== b.b ||
		a.c !== b.c ||
		a.d !== b.d ||
		a.e !== b.e ||
		a.f !== b.f
	) {
		change |= SpaceChange.MATRIX;
	}
	if (previous.opacity !== next.opacity) change |= SpaceChange.OPACITY;
	if (previous.clip !== next.clip) change |= SpaceChange.CLIP;
	if (previous.penScale !== next.penScale) change |= SpaceChange.PEN_SCALE;
	if (previous.yUp !== next.yUp) change |= SpaceChange.Y_UP;
	if (previous.lengthScale !== next.lengthScale) {
		change |= SpaceChange.LENGTH_SCALE;
	}
	return change;
}

/** Whether two boxes are the same. */
function sameBounds(a: Bounds | null, b: Bounds | null): boolean {
	if (!a || !b) return a === b;
	return (
		a.minX === b.minX &&
		a.minY === b.minY &&
		a.maxX === b.maxX &&
		a.maxY === b.maxY
	);
}

/**
 * Makes a text definition: `text(props)` gives the string, and the shared
 * text pipeline does the rest (theme defaults, the enclosing space, reveal,
 * interaction, a measured handle).
 *
 * @example
 * ```ts
 * import { defineText, Invalidate, type TextProps, textProps } from "@sophistry/core";
 *
 * interface CounterProps extends TextProps {
 * 	value: number;
 * }
 *
 * export const counter = defineText<CounterProps>({
 * 	name: "Counter",
 * 	props: { ...textProps, value: { default: 0, invalidates: Invalidate.GEOMETRY } },
 * 	text: (props) => String(Math.round(props.value)),
 * });
 * ```
 *
 * @param options - See {@link TextOptions}.
 * @returns The definition; `create(props)` makes a {@link TextNode}.
 * @category Text & numbers
 */
export function defineText<P extends TextProps>(
	options: TextOptions<P>,
): Definition<P, TextNode<P>> {
	return definePrimitive<P, TextNode<P>>({
		name: options.name,
		props: options.props,
		node: (definition) => new TextNode<P>(definition, options),
	});
}

/** @category Text & numbers */
export interface TextNodeProps extends TextProps {
	/** What to draw: a string, or strings and spans. Empty draws nothing. */
	text: RichText;
}

/**
 * Text, positioned in scene units and styled by the active theme: one line,
 * several (`"\n"` breaks), wrapped at a `width`, and styled run by run with
 * {@link TextSpan}s.
 *
 * Font size, letter spacing, width and the anchor are all in scene units, so
 * text scales with any enclosing `group`. It is centred on its anchor by
 * default (`align` and `baseline` move it, and `textAlign` sets how lines
 * sit in a block). Its handles (`bounds()`, `pointAt(...)`) are the measured
 * box, which lets captions take part in layout (`nextTo`, `toEdge`, ...).
 *
 * @example
 * ```ts
 * import { createScene, text } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(text.create({ text: "x²", x: 1, fontSize: 0.5 }));
 * scene.root.add(
 * 	text.create({
 * 		text: ["The ", { text: "derivative", fontWeight: 700, color: "#58c4dd" }, " measures change."],
 * 		width: 4,
 * 		y: -1,
 * 	}),
 * );
 * ```
 *
 * @category Text & numbers
 */
export const text = defineText<TextNodeProps>({
	name: "Text",
	props: {
		...textProps,
		text: { default: "", invalidates: Invalidate.GEOMETRY },
	},
	text: (props) => props.text ?? "",
});
