/**
 * `bulletedList` and `title`: presets built from `text` nodes. A list is one
 * `text` per item, wrapped at the list's width less the indent, with its
 * bullet hanging to the left; a title is a heading pinned to the top of the
 * frame with a rule under it.
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
import type { RichText, TextNode, TextNodeProps } from "../scene/text.js";
import { text } from "../scene/text.js";
import type {
	ContextKey,
	Definition,
	InvalidateBits,
	PropsDescriptor,
	SceneNode,
} from "../scene/types.js";
import { SpaceChange } from "../scene/types.js";
import { type LineProps, line } from "../shapes/line.js";
import type { TextFont } from "../spec/bake.js";
import { bakeTextFont } from "../spec/bake.js";
import type { Placement } from "../spec/layout.js";
import { readDelta } from "../spec/layout.js";
import { measureLabel } from "../spec/metrics.js";
import { layoutText } from "../spec/text-layout.js";
import type { Theme } from "../themes/types.js";
import { boxPolyline, TextLayoutNode } from "./text-layout.js";

/** Line height as a multiple of the font size, when none is given. */
const DEFAULT_LINE_HEIGHT = 1.3;

/* --------------------------------------------------------- bulleted list */

/** @category Text & numbers */
export interface BulletedListProps {
	/** The items, one bullet each: strings, or strings and spans. */
	items: readonly RichText[];
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
	/** Where a placement function put the list. Adds to `x`/`y`. */
	place?: Placement;
	/**
	 * List centre x.
	 * @default 0
	 */
	x?: number;
	/**
	 * List centre y.
	 * @default 0
	 */
	y?: number;
	/**
	 * Opacity 0..1.
	 * @default 1
	 */
	opacity?: number;
	/**
	 * Reveal, 0..1: an item at a time, its bullet with it.
	 * @default 1
	 */
	progress?: number;
	/**
	 * Paint order.
	 * @default 0
	 */
	zIndex?: number;
	/**
	 * `false` hides the list.
	 * @default true
	 */
	visible?: boolean;
}

/** One item laid out: its top (down from the list's top) and first baseline. */
interface ItemLayout {
	top: number;
	firstBaseline: number;
}

interface ListLayout {
	items: ItemLayout[];
	width: number;
	height: number;
}

/**
 * A `bulletedList` node; its handle is the list's box.
 *
 * @category Text & numbers
 */
export class BulletedListNode extends TextLayoutNode<BulletedListProps> {
	/**
	 * The list is laid out in its own units: the groups' scale scales it
	 * whole. Only a length unit changes it, through the default font size.
	 */
	protected override readonly spaceFields: number = SpaceChange.LENGTH_SCALE;

	private list: ListLayout | null = null;
	/** The font the list was measured with. */
	private listFont: TextFont | null = null;
	private nodes: TextNode<TextNodeProps>[] = [];
	private readonly fontOf = memo(
		(
			fontSize: number | undefined,
			fontFamily: string | undefined,
			fontWeight: string | number | undefined,
			italic: boolean | undefined,
			theme: Theme,
			lengthScale: number,
		): TextFont =>
			bakeTextFont(
				{ fontSize, fontFamily, fontWeight, italic },
				theme,
				1,
				lengthScale,
			),
	);
	private readonly boxOf = memo((width: number, height: number): Polyline[] => [
		boxPolyline(-width / 2, -height / 2, width / 2, height / 2),
	]);
	private readonly matrixOf = lastMatrix();

	/** Measures every item, in local units, down from the list's top. */
	private measure(font: TextFont, indent: number): ListLayout {
		const props = this.props;
		const measure =
			props.width !== undefined ? Math.max(0, props.width - indent) : undefined;
		const gap = font.fontSize * (props.itemGap ?? 0.25);
		const items: ItemLayout[] = [];
		let top = 0;
		let widest = 0;
		(props.items ?? []).forEach((item, index) => {
			if (index > 0) top += gap;
			const runs =
				typeof item === "string"
					? [{ text: item, font }]
					: item.map((part) =>
							typeof part === "string"
								? { text: part, font }
								: {
										text: part.text,
										font: {
											...font,
											fontSize: part.fontSize ?? font.fontSize,
											fontWeight: part.fontWeight ?? font.fontWeight,
											fontFamily: part.fontFamily ?? font.fontFamily,
											italic: part.italic ?? font.italic,
											letterSpacing: part.letterSpacing ?? font.letterSpacing,
										},
									},
						);
			const laid = layoutText(runs, {
				width: measure,
				lineHeight: props.lineHeight ?? DEFAULT_LINE_HEIGHT,
			});
			items.push({ top, firstBaseline: laid.firstBaseline });
			widest = Math.max(widest, laid.contentWidth);
			top += laid.height;
		});
		return { items, width: props.width ?? indent + widest, height: top };
	}

	protected layout(dirty: InvalidateBits): readonly SceneNode[] {
		const props = this.props;
		const font = this.fontOf(
			props.fontSize,
			props.fontFamily,
			props.fontWeight,
			props.italic,
			this.context(themeContext),
			this.space.lengthScale,
		);
		const indent = props.indent ?? font.fontSize * 0.6;
		// Measuring is the expensive half: only a font, item or measure change
		// (or a web font arriving) re-measures; a reveal or a move reuses it.
		if (!this.list || dirty & Invalidate.GEOMETRY || font !== this.listFont) {
			this.list = this.measure(font, indent);
			this.listFont = font;
		}
		const list = this.list;
		const anchor = this.anchor();
		const left = anchor.x - list.width / 2;
		const top = anchor.y + list.height / 2;
		const count = list.items.length || 1;
		const items = props.items ?? [];
		const wanted = list.items.length * 2;
		if (this.nodes.length !== wanted) this.nodes = this.nodes.slice(0, wanted);
		const shared = {
			fontSize: font.fontSize,
			fontFamily: font.fontFamily,
			fontWeight: font.fontWeight,
			italic: font.italic,
			color: props.color,
			opacity: props.opacity,
			zIndex: props.zIndex,
			visible: props.visible,
			align: "left" as const,
			baseline: "alphabetic" as const,
			lineHeight: props.lineHeight ?? DEFAULT_LINE_HEIGHT,
		};
		list.items.forEach((item, index) => {
			const y = top - item.top - item.firstBaseline;
			const progress = progressIn(
				props.progress ?? 1,
				index / count,
				(index + 1) / count,
			);
			const bullet = this.nodeAt(index * 2);
			bullet.update({
				...shared,
				text: props.bullet ?? "•",
				x: left,
				y,
				progress,
			});
			const body = this.nodeAt(index * 2 + 1);
			body.update({
				...shared,
				text: items[index] ?? "",
				width:
					props.width !== undefined
						? Math.max(0, props.width - indent)
						: undefined,
				x: left + indent,
				y,
				progress,
			});
		});
		return this.nodes;
	}

	/** The text node in slot `index`, made the first time it is asked for. */
	private nodeAt(index: number): TextNode<TextNodeProps> {
		let node = this.nodes[index];
		if (!node) {
			node = text.create({ text: "" });
			this.nodes[index] = node;
		}
		return node;
	}

	/** The anchor in local units, `place` folded into `x`/`y`. */
	private anchor(): Point {
		const props = this.props;
		const delta = readDelta(props.place);
		return { x: (props.x ?? 0) + delta.x, y: (props.y ?? 0) + delta.y };
	}

	/* ----------------------------------------------------------- handles */

	/** The list's box about its centre: as wide as its measure, or its widest item. */
	protected override localOutline(): readonly Polyline[] | null {
		const list = this.list;
		return list ? this.boxOf(list.width, list.height) : null;
	}

	protected override localMatrix(): Matrix | null {
		const anchor = this.anchor();
		return this.matrixOf(
			fromTranslationRotationScale({ x: anchor.x, y: anchor.y }),
		);
	}

	protected override disposeContents(): void {
		super.disposeContents();
		this.nodes = [];
	}
}

/**
 * Descriptor entries for every {@link BulletedListProps} key. The font,
 * items and measure re-measure the list (`GEOMETRY`); the rest only restyle
 * or move it.
 *
 * @category Text & numbers
 */
export const bulletedListProps: PropsDescriptor<BulletedListProps> =
	Object.freeze({
		items: {
			default: [],
			invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY,
		},
		width: { invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY },
		bullet: { default: "•", invalidates: Invalidate.UPDATE },
		indent: { invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY },
		itemGap: {
			default: 0.25,
			invalidates: Invalidate.UPDATE | Invalidate.GEOMETRY,
		},
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

/**
 * `bulletedList`: one bullet per item, left-aligned, with a hanging indent
 * when an item wraps. Revealed an item at a time, its bullet with it. Items
 * take spans, like {@link text}.
 *
 * @example
 * ```ts
 * import { bulletedList, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.add(bulletedList.create({ items: ["Differentiate", ["Integrate ", { text: "by parts", italic: true }]], width: 5 }));
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
	extends Omit<
		BulletedListProps,
		| "items"
		| "width"
		| "bullet"
		| "indent"
		| "itemGap"
		| "x"
		| "y"
		| "place"
		| "lineHeight"
	> {
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

	private textNode: TextNode<TextNodeProps> | null = null;
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

		this.textNode ??= text.create({ text: "" });
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
