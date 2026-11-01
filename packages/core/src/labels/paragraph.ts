/**
 * `paragraph`, `bulletedList` and `title`: multi-line text as a stack of
 * `label`s, wrapped greedily by measured word widths (`wrapText`). The block
 * is centred on its anchor, takes `place`, and its handle reports the whole
 * box. No hyphenation, justification or mid-word breaks.
 */

import type { ColorInput } from "../color/index.js";
import type { Bounds, Point, Polyline } from "../geometry/index.js";
import { progressIn } from "../geometry/lerp.js";
import type { Matrix } from "../geometry/transform.js";
import { fromTranslationRotationScale } from "../geometry/transform.js";
import type { Readable } from "../reactive/index.js";
import { frameContext, Invalidate, themeContext } from "../scene/context.js";
import { memo } from "../scene/node.js";
import { definePrimitive } from "../scene/primitive.js";
import type { ShapeNode } from "../scene/shape.js";
import { lastMatrix } from "../scene/shape.js";
import type { LabelProps, TextNode } from "../scene/text.js";
import { label } from "../scene/text.js";
import type {
	ContextKey,
	Definition,
	InvalidateBits,
	PropsDescriptor,
	SceneNode,
} from "../scene/types.js";
import { type LineProps, line } from "../shapes/line.js";
import type { TextFont } from "../spec/bake.js";
import { bakeTextFont } from "../spec/bake.js";
import type { Placement } from "../spec/layout.js";
import { readDelta } from "../spec/layout.js";
import type { MetricsStyle } from "../spec/metrics.js";
import { measureLabel } from "../spec/metrics.js";
import type { Theme } from "../themes/types.js";
import { boxPolyline, TextLayoutNode } from "./text-layout.js";

/** Line height as a multiple of the font size, when none is given. */
const DEFAULT_LINE_HEIGHT = 1.3;

/**
 * Breaks `text` into lines no wider than `width`, greedily, a word at a time,
 * measured with the metrics oracle. Newlines always break, and an empty line
 * stays an empty line. Runs of spaces collapse to one. Without a `width`
 * only newlines break. A word wider than `width` gets a line of its own.
 *
 * @example
 * ```ts
 * import { wrapText } from "@sophistry/core";
 *
 * const lines = wrapText("the quick brown fox", { fontSize: 0.4, fontFamily: "sans-serif", fontWeight: 500, italic: false, letterSpacing: 0 }, 2);
 * ```
 *
 * @param text - The text to wrap.
 * @param style - Font, in the same length unit as `width`.
 * @param width - The measure; omitted or non-positive, nothing wraps.
 * @returns The lines, in order.
 *
 * @category Text & numbers
 */
export function wrapText(
	text: string,
	style: MetricsStyle,
	width?: number,
): string[] {
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
		if (words.length === 0) {
			lines.push("");
			continue;
		}
		if (!(width !== undefined && width > 0)) {
			lines.push(words.join(" "));
			continue;
		}
		let line = words[0] as string;
		for (const word of words.slice(1)) {
			const next = `${line} ${word}`;
			if (measureLabel(next, style).width <= width) line = next;
			else {
				lines.push(line);
				line = word;
			}
		}
		lines.push(line);
	}
	return lines;
}

/**
 * Text props shared by the block definitions.
 *
 * @category Text & numbers
 */
export interface TextBlockStyleProps {
	/** Font size. Defaults to the theme's. */
	fontSize?: number;
	/** Text colour. Defaults to the theme foreground. */
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
	 * Line height as a multiple of the font size.
	 * @default 1.3
	 */
	lineHeight?: number;
	/** Where a placement function put the block. Adds to `x`/`y`. */
	place?: Placement;
	/**
	 * Block centre x.
	 * @default 0
	 */
	x?: number;
	/**
	 * Block centre y.
	 * @default 0
	 */
	y?: number;
	/**
	 * Opacity 0..1.
	 * @default 1
	 */
	opacity?: number;
	/**
	 * Reveal, 0..1: line after line, each wiping left to right.
	 * @default 1
	 */
	progress?: number;
	/**
	 * Paint order.
	 * @default 0
	 */
	zIndex?: number;
	/**
	 * `false` hides the block.
	 * @default true
	 */
	visible?: boolean;
}

/**
 * Descriptor entries for every {@link TextBlockStyleProps} key. The font and
 * line height re-lay the block out (`GEOMETRY`); the rest only restyle or
 * move its lines.
 *
 * @category Text & numbers
 */
export const textBlockStyleProps: PropsDescriptor<TextBlockStyleProps> =
	Object.freeze({
		fontSize: { invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY },
		color: { invalidates: Invalidate.UPDATE },
		fontFamily: { invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY },
		fontWeight: {
			default: 500,
			invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY,
		},
		italic: {
			default: false,
			invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY,
		},
		lineHeight: {
			default: DEFAULT_LINE_HEIGHT,
			invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY,
		},
		place: { invalidates: Invalidate.UPDATE },
		x: { default: 0, invalidates: Invalidate.UPDATE },
		y: { default: 0, invalidates: Invalidate.UPDATE },
		opacity: { default: 1, invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		zIndex: { default: 0, invalidates: Invalidate.UPDATE },
		visible: { default: true, invalidates: Invalidate.UPDATE },
	});

/** One label of a laid-out block, relative to the block's centre. */
interface BlockLine {
	text: string;
	x: number;
	y: number;
	align: CanvasTextAlign;
}

/** What a block's layout produces: its labels and its size. */
interface BlockLayout {
	lines: BlockLine[];
	width: number;
	height: number;
	/** Which reveal slot each label belongs to (a bullet shares its item's first line's). */
	slots: number[];
	slotCount: number;
}

/**
 * A laid-out block of text: one `label` per line, centred on the anchor,
 * revealed slot by slot. Its handle is the block's box, so `nextTo`,
 * `arrange` and `surround` treat it as one thing.
 *
 * @typeParam P - The block's props.
 *
 * @category Text & numbers
 */
export abstract class TextBlockNode<
	P extends TextBlockStyleProps = TextBlockStyleProps,
> extends TextLayoutNode<P> {
	/** The block is laid out in its own units: the groups' scale scales it whole. */
	protected override readonly spaceFields: number = 0;

	private block: BlockLayout | null = null;
	private lineNodes: TextNode<LabelProps>[] = [];
	private readonly fontOf = memo(
		(
			fontSize: number | undefined,
			fontFamily: string | undefined,
			fontWeight: string | number | undefined,
			italic: boolean | undefined,
			theme: Theme,
		): TextFont =>
			bakeTextFont({ fontSize, fontFamily, fontWeight, italic }, theme),
	);
	private readonly boxOf = memo((width: number, height: number): Polyline[] => [
		boxPolyline(-width / 2, -height / 2, width / 2, height / 2),
	]);
	private readonly matrixOf = lastMatrix();

	/** Lays the block out for `font`, in local units about the block's centre. */
	protected abstract blockLayout(font: TextFont): BlockLayout;

	protected layout(dirty: InvalidateBits): readonly SceneNode[] {
		const props = this.props;
		const font = this.fontOf(
			props.fontSize,
			props.fontFamily,
			props.fontWeight,
			props.italic,
			this.context(themeContext),
		);
		// Measuring is the expensive half: only a font, text or measure change
		// (or a web font arriving) re-wraps; a reveal or a move reuses the lines.
		if (!this.block || dirty & Invalidate.GEOMETRY)
			this.block = this.blockLayout(font);
		const block = this.block;

		const anchor = this.anchor();
		const count = block.slotCount || 1;
		let nodes = this.lineNodes;
		if (nodes.length !== block.lines.length) {
			nodes = nodes.slice(0, block.lines.length);
			this.lineNodes = nodes;
		}
		for (let i = 0; i < block.lines.length; i++) {
			const line = block.lines[i] as BlockLine;
			let node = nodes[i];
			if (!node) {
				node = label.create({ text: "" });
				nodes[i] = node;
			}
			const slot = block.slots[i] ?? 0;
			node.update({
				text: line.text,
				x: anchor.x + line.x,
				y: anchor.y + line.y,
				align: line.align,
				fontSize: font.fontSize,
				fontFamily: font.fontFamily,
				fontWeight: font.fontWeight,
				italic: font.italic,
				color: props.color,
				opacity: props.opacity,
				zIndex: props.zIndex,
				visible: props.visible,
				progress: progressIn(
					props.progress ?? 1,
					slot / count,
					(slot + 1) / count,
				),
			});
		}
		return nodes;
	}

	/** The anchor in local units, `place` folded into `x`/`y`. */
	private anchor(): Point {
		const props = this.props;
		const delta = readDelta(props.place);
		return { x: (props.x ?? 0) + delta.x, y: (props.y ?? 0) + delta.y };
	}

	/* ----------------------------------------------------------- handles */

	/** The block's box about its centre: as wide as its measure, or its longest line. */
	protected override localOutline(): readonly Polyline[] | null {
		const block = this.block;
		return block ? this.boxOf(block.width, block.height) : null;
	}

	protected override localMatrix(): Matrix | null {
		const anchor = this.anchor();
		return this.matrixOf(
			fromTranslationRotationScale({ x: anchor.x, y: anchor.y }),
		);
	}

	protected override disposeContents(): void {
		super.disposeContents();
		this.lineNodes = [];
	}
}

/* -------------------------------------------------------------- paragraph */

/** @category Text & numbers */
export interface ParagraphProps extends TextBlockStyleProps {
	/** The text. Newlines break lines; with `width`, so does running out of room. */
	text: string;
	/** Wrap to this measure, in scene units. Omitted, only newlines break. */
	width?: number;
	/**
	 * How lines sit in the block.
	 * @default `"left"`
	 */
	align?: "left" | "center" | "right";
}

/**
 * A `paragraph` node; its handle is the block's box.
 *
 * @category Text & numbers
 */
export class ParagraphNode extends TextBlockNode<ParagraphProps> {
	protected blockLayout(style: TextFont): BlockLayout {
		const props = this.props;
		const lines = wrapText(props.text ?? "", style, props.width);
		const widths = lines.map((line) => measureLabel(line, style).width);
		const width = props.width ?? Math.max(0, ...widths);
		const step = style.fontSize * (props.lineHeight ?? DEFAULT_LINE_HEIGHT);
		const height = step * lines.length;
		const align = props.align ?? "left";
		const x = align === "left" ? -width / 2 : align === "right" ? width / 2 : 0;
		return {
			lines: lines.map((text, i) => ({
				text,
				x,
				y: height / 2 - step * (i + 0.5),
				align,
			})),
			width,
			height,
			slots: lines.map((_, i) => i),
			slotCount: lines.length,
		};
	}
}

/**
 * Descriptor entries for every {@link ParagraphProps} key.
 *
 * @category Text & numbers
 */
export const paragraphProps: PropsDescriptor<ParagraphProps> = Object.freeze({
	...textBlockStyleProps,
	text: { default: "", invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY },
	width: { invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY },
	align: {
		default: "left",
		invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY,
	},
});

/**
 * `paragraph`: text over several lines, wrapped to a measure; Manim's
 * `Paragraph` with `MarkupText`'s wrapping, minus the markup.
 *
 * The block is centred on `x`/`y` (or wherever `place` puts it) and its
 * handle reports the whole block's box, so `nextTo`, `arrange` and
 * `surround` treat it as one thing. With `width` the block is that wide
 * whatever its lines are; without, it is as wide as its longest line.
 * `progress` writes it line by line, each wiping left to right as a `label`
 * does.
 *
 * @example
 * ```ts
 * import { createScene, paragraph } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.add(paragraph.create({ text: "A long sentence that wraps.", width: 4, fontSize: 0.4 }));
 * ```
 *
 * @category Text & numbers
 */
export const paragraph: Definition<ParagraphProps, ParagraphNode> =
	definePrimitive<ParagraphProps, ParagraphNode>({
		name: "Paragraph",
		props: paragraphProps,
		node: (definition) => new ParagraphNode(definition),
	});

/* ---------------------------------------------------------- bulleted list */

/** @category Text & numbers */
export interface BulletedListProps extends TextBlockStyleProps {
	/** The items, one bullet each. */
	items: readonly string[];
	/** Wrap each item to this measure (bullet and indent included), scene units. */
	width?: number;
	/**
	 * The bullet.
	 * @default `"•"`
	 */
	bullet?: string;
	/** Space from the bullet to the text, scene units. Defaults to 0.6 of the font size. */
	indent?: number;
	/**
	 * Extra space between items, as a multiple of the font size.
	 * @default 0.25
	 */
	itemGap?: number;
}

/**
 * A `bulletedList` node; its handle is the block's box.
 *
 * @category Text & numbers
 */
export class BulletedListNode extends TextBlockNode<BulletedListProps> {
	protected blockLayout(style: TextFont): BlockLayout {
		const props = this.props;
		const items = props.items ?? [];
		const bullet = props.bullet ?? "•";
		const indent = props.indent ?? style.fontSize * 0.6;
		const step = style.fontSize * (props.lineHeight ?? DEFAULT_LINE_HEIGHT);
		const gap = style.fontSize * (props.itemGap ?? 0.25);
		const measure =
			props.width !== undefined ? Math.max(0, props.width - indent) : undefined;

		const rows: { text: string; item: number; first: boolean; y: number }[] =
			[];
		let y = 0;
		items.forEach((item, index) => {
			if (index > 0) y += gap;
			wrapText(item, style, measure).forEach((text, i) => {
				rows.push({ text, item: index, first: i === 0, y: y + step / 2 });
				y += step;
			});
		});
		const height = y;
		const textWidth = Math.max(
			0,
			...rows.map((row) => measureLabel(row.text, style).width),
		);
		const width = props.width ?? indent + textWidth;
		const left = -width / 2;

		const lines: BlockLine[] = [];
		const slots: number[] = [];
		for (const row of rows) {
			if (row.first) {
				lines.push({
					text: bullet,
					x: left,
					y: height / 2 - row.y,
					align: "left",
				});
				slots.push(row.item);
			}
			lines.push({
				text: row.text,
				x: left + indent,
				y: height / 2 - row.y,
				align: "left",
			});
			slots.push(row.item);
		}
		return { lines, width, height, slots, slotCount: items.length };
	}
}

/**
 * Descriptor entries for every {@link BulletedListProps} key.
 *
 * @category Text & numbers
 */
export const bulletedListProps: PropsDescriptor<BulletedListProps> =
	Object.freeze({
		...textBlockStyleProps,
		items: {
			default: [],
			invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY,
		},
		width: { invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY },
		bullet: {
			default: "•",
			invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY,
		},
		indent: { invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY },
		itemGap: {
			default: 0.25,
			invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY,
		},
	});

/**
 * `bulletedList`: one bullet per item, left-aligned, with a hanging indent
 * when an item wraps. Laid out and revealed like a {@link paragraph}, an item
 * at a time (its bullet with it).
 *
 * @example
 * ```ts
 * import { bulletedList, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.add(bulletedList.create({ items: ["Differentiate", "Integrate"], width: 5 }));
 * ```
 *
 * @category Text & numbers
 */
export const bulletedList: Definition<BulletedListProps, BulletedListNode> =
	definePrimitive<BulletedListProps, BulletedListNode>({
		name: "BulletedList",
		props: bulletedListProps,
		node: (definition) => new BulletedListNode(definition),
	});

/* ------------------------------------------------------------------ title */

/** @category Text & numbers */
export interface TitleProps
	extends Omit<TextBlockStyleProps, "x" | "y" | "place" | "lineHeight"> {
	/** The title text. */
	text: string;
	/**
	 * Gap between the top of the frame and the text, scene units.
	 * @default 0.5
	 */
	margin?: number;
	/**
	 * Draw a rule under the title.
	 * @default true
	 */
	underline?: boolean;
	/**
	 * Make the rule as wide as the text instead of nearly the frame.
	 * @default false
	 */
	matchUnderlineToText?: boolean;
	/** Underline colour. Defaults to the text colour. */
	underlineColor?: ColorInput;
}

/** Gap between a title's text and its underline, as a multiple of the font size. */
const UNDERLINE_GAP = 0.3;
/** How far the full-width underline stops short of each side of the frame. */
const UNDERLINE_INSET = 1;

/**
 * A `title` node; its handle is the text's box, not the rule's.
 *
 * @category Text & numbers
 */
export class TitleNode extends TextLayoutNode<TitleProps> {
	/** The title is placed against the frame in its own units. */
	protected override readonly spaceFields: number = 0;

	private textNode: TextNode<LabelProps> | null = null;
	private ruleNode: ShapeNode<LineProps> | null = null;
	/** The frame `Readable` followed, and how to stop following it. */
	private frameSource: Readable<Bounds> | null = null;
	private stopFrame: (() => void) | null = null;
	private shown: readonly SceneNode[] = [];

	private readonly fontOf = memo(
		(
			fontSize: number,
			fontFamily: string | undefined,
			fontWeight: string | number | undefined,
			italic: boolean | undefined,
			theme: Theme,
		): TextFont =>
			bakeTextFont({ fontSize, fontFamily, fontWeight, italic }, theme),
	);

	protected override stagesForContext(
		key: ContextKey<unknown>,
	): InvalidateBits {
		return key === frameContext
			? Invalidate.UPDATE
			: super.stagesForContext(key);
	}

	protected layout(_dirty: InvalidateBits): readonly SceneNode[] {
		const props = this.props;
		const theme = this.context(themeContext);
		const box = this.followFrame().peek();
		const fontSize = props.fontSize ?? theme.defaults.fontSize * 1.5;
		const style = this.fontOf(
			fontSize,
			props.fontFamily,
			props.fontWeight,
			props.italic,
			theme,
		);
		// `measureLabel` caches on the string and font and drops the cache on a
		// web font load, which reruns this (`fontEpochContext`).
		const metrics = measureLabel(props.text ?? "", style);
		const half = (metrics.ascent + metrics.descent) / 2;
		const centre: Point = {
			x: (box.minX + box.maxX) / 2,
			y: box.maxY - (props.margin ?? 0.5) - half,
		};

		this.textNode ??= label.create({ text: "" });
		const textNode = this.textNode;
		textNode.update({
			text: props.text ?? "",
			x: centre.x,
			y: centre.y,
			fontSize,
			fontFamily: props.fontFamily,
			fontWeight: props.fontWeight,
			italic: props.italic,
			color: props.color,
			opacity: props.opacity,
			zIndex: props.zIndex,
			visible: props.visible,
			progress: props.progress,
		});

		if (props.underline === false) {
			// Dropped from the children, so disposed; a later `underline` makes a new one.
			this.ruleNode = null;
			if (this.shown.length !== 1) this.shown = [textNode];
			return this.shown;
		}

		const y = centre.y - half - fontSize * UNDERLINE_GAP;
		const halfWidth = props.matchUnderlineToText
			? metrics.width / 2
			: Math.max(0, (box.maxX - box.minX) / 2 - UNDERLINE_INSET);
		const from = { x: centre.x - halfWidth, y };
		const to = { x: centre.x + halfWidth, y };
		this.ruleNode ??= line.create({ from, to });
		const ruleNode = this.ruleNode;
		const previousFrom = ruleNode.get("from");
		const previousTo = ruleNode.get("to");
		ruleNode.update({
			// Kept while equal: a new point object would rebuild the outline.
			from:
				previousFrom.x === from.x && previousFrom.y === from.y
					? previousFrom
					: from,
			to: previousTo.x === to.x && previousTo.y === to.y ? previousTo : to,
			stroke: props.underlineColor ?? props.color ?? theme.palette.foreground,
			opacity: props.opacity,
			zIndex: props.zIndex,
			visible: props.visible,
			progress: props.progress,
		});
		if (this.shown.length !== 2) this.shown = [textNode, ruleNode];
		return this.shown;
	}

	/** The scene's frame, followed: a camera move re-places the title. */
	private followFrame(): Readable<Bounds> {
		const frame = this.context(frameContext);
		if (frame !== this.frameSource) {
			this.stopFrame?.();
			this.frameSource = frame;
			this.stopFrame = frame.subscribe(() =>
				this.invalidate(Invalidate.UPDATE),
			);
		}
		return frame;
	}

	/* ----------------------------------------------------------- handles */

	/** The text's box, not the rule's. */
	override bounds(): Bounds | null {
		this.refresh();
		return this.textNode?.bounds() ?? null;
	}

	override localBounds(): Bounds | null {
		this.refresh();
		return this.textNode?.localBounds() ?? null;
	}

	protected override disposeContents(): void {
		super.disposeContents();
		this.stopFrame?.();
		this.stopFrame = null;
		this.frameSource = null;
		this.textNode = null;
		this.ruleNode = null;
		this.shown = [];
	}
}

/**
 * Descriptor entries for every {@link TitleProps} key.
 *
 * @category Text & numbers
 */
export const titleProps: PropsDescriptor<TitleProps> = Object.freeze({
	fontSize: { invalidates: Invalidate.UPDATE },
	color: { invalidates: Invalidate.UPDATE },
	fontFamily: { invalidates: Invalidate.UPDATE },
	fontWeight: { default: 500, invalidates: Invalidate.UPDATE },
	italic: { default: false, invalidates: Invalidate.UPDATE },
	opacity: { default: 1, invalidates: Invalidate.UPDATE },
	progress: { default: 1, invalidates: Invalidate.UPDATE },
	zIndex: { default: 0, invalidates: Invalidate.UPDATE },
	visible: { default: true, invalidates: Invalidate.UPDATE },
	text: { default: "", invalidates: Invalidate.UPDATE },
	margin: { default: 0.5, invalidates: Invalidate.UPDATE },
	underline: { default: true, invalidates: Invalidate.UPDATE },
	matchUnderlineToText: { default: false, invalidates: Invalidate.UPDATE },
	underlineColor: { invalidates: Invalidate.UPDATE },
});

/**
 * `title`: a heading at the top of the frame with a rule under it; Manim's
 * `Title`. Centred on the visible frame, so it follows a camera that moves.
 * The rule spans the frame (less a margin each side), or just the text with
 * `matchUnderlineToText`. Its handle reports the text's box, not the rule's.
 *
 * @example
 * ```ts
 * import { createScene, title } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.add(title.create({ text: "The chain rule" }));
 * ```
 *
 * @category Text & numbers
 */
export const title: Definition<TitleProps, TitleNode> = definePrimitive<
	TitleProps,
	TitleNode
>({
	name: "Title",
	props: titleProps,
	node: (definition) => new TitleNode(definition),
});
