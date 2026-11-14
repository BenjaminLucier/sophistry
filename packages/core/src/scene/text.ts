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
	fromTranslationRotationScale,
	scaleFactorOf,
} from "../geometry/transform.js";
import type { InteractionProps } from "../interact/types.js";
import type { TextBlockRun, TextHalo, TextStyleInput } from "../spec/bake.js";
import { bakeTextBlock, bakeTextSpec, bakeTextStyle } from "../spec/bake.js";
import type { Placement } from "../spec/layout.js";
import { readDelta } from "../spec/layout.js";
import { fontLoads, labelBox } from "../spec/metrics.js";
import type {
	ClipRegion,
	TextFragment,
	TextSpec,
	TextStyle,
} from "../spec/types.js";
import type { LengthUnit } from "./context.js";
import {
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
 * What a text node draws: a string, or strings and {@link TextSpan}s in
 * reading order. `"\n"` starts a new line.
 *
 * @category Text & numbers
 */
export type RichText = string | readonly (string | TextSpan)[];

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
		.map((part) => (typeof part === "string" ? part : part.text))
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
export class TextNode<P extends TextProps = TextProps> extends BaseNode<P> {
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
			_fontEpoch: number,
		): { fragments: TextFragment[]; box: Bounds } =>
			bakeTextBlock(this.runsOf(content, style), {
				width,
				lineHeight,
				textAlign,
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
			block: { fragments: TextFragment[]; box: Bounds } | undefined,
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

	constructor(definition: Definition<P>, options: TextOptions<P>) {
		super(definition);
		this.options = options;
	}

	/* ------------------------------------------------------------ stages */

	protected run(dirty: InvalidateBits): void {
		if (dirty & Invalidate.GEOMETRY) this.content = null;
		if (dirty & Invalidate.STYLE) this.style = null;
		this.publish(this.assemble());
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
		if (key === themeContext || key === ANY_CONTEXT) return Invalidate.STYLE;
		if (key === pixelsPerUnitContext) {
			return this.props.lengthUnit === undefined ? 0 : Invalidate.STYLE;
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
		this.content ??= this.options.text(this.props);
		return this.content;
	}

	/** The plain text: every run's text together. */
	private currentText(): string {
		return this.plainOf(this.currentContent());
	}

	/**
	 * The laid-out block, or undefined for one plain line (no spans, no
	 * newline, no width), which is drawn and measured as a single run.
	 */
	private currentBlock():
		| { fragments: TextFragment[]; box: Bounds }
		| undefined {
		const content = this.currentContent();
		const width = this.props.width;
		if (
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
			this.props.lineHeight,
			this.props.textAlign,
			fontLoads.peek(),
		);
	}

	/** The runs of `content`, each span's style baked over the node's. */
	private runsOf(content: RichText, base: TextStyle): TextBlockRun[] {
		if (typeof content === "string") return [{ text: content, style: base }];
		const input = this.styleInput();
		const theme = this.context(themeContext);
		const space = this.space;
		const { scale, lengthScale } = this.units();
		return content.map((part): TextBlockRun => {
			if (typeof part === "string") return { text: part, style: base };
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
			if (part.underline) run.underline = true;
			if (part.strikethrough) run.strikethrough = true;
			if (part.highlight !== undefined)
				run.highlight = cssColor(part.highlight);
			return run;
		});
	}

	/** The node's own style props, as the baker takes them. */
	private styleInput(): TextStyleInput {
		const props = this.props;
		return {
			fill: props.color,
			fontSize: props.fontSize,
			fontFamily: props.fontFamily,
			fontWeight: props.fontWeight,
			italic: props.italic,
			align: props.align,
			baseline: props.baseline,
			opacity: props.opacity,
			letterSpacing: props.letterSpacing,
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
