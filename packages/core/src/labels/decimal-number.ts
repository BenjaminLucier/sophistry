/**
 * `decimalNumber`, `integer` and `variable`: numbers as scene objects.
 * `value` is an ordinary prop (so a `track` or `valueTo` animates it; no
 * `ChangingDecimal`), formatting is `digits.ts`, and each character is its
 * own node, which gives tabular columns and per-digit styling through
 * `digitStyle`.
 */

import type { ColorInput } from "../color";
import { cssColor } from "../color";
import type { Bounds, Point, Polyline } from "../geometry";
import { progressIn } from "../geometry/lerp";
import type { Matrix } from "../geometry/transform";
import {
	applyToPoint,
	applyToPolyline,
	compose,
	fromTranslationRotationScale,
	scaleFactorOf,
} from "../geometry/transform";
import { Invalidate, themeContext } from "../scene/context";
import { BaseNode, memo } from "../scene/node";
import { definePrimitive } from "../scene/primitive";
import { boundsOfPolylines, lastMatrix } from "../scene/shape";
import type { LabelProps, TextNode } from "../scene/text";
import { label } from "../scene/text";
import type {
	Definition,
	InvalidateBits,
	PropsDescriptor,
	SceneNode,
} from "../scene/types";
import { SpaceChange } from "../scene/types";
import { bakeTextFont, bakeTextStyle, textRotation } from "../spec/bake";
import { clipOf } from "../spec/clip";
import type { BoxStyle } from "../spec/metrics";
import { fontLoads, labelBox } from "../spec/metrics";
import type { ClipRegion, TextSpec, TextStyle } from "../spec/types";
import type { Theme } from "../themes/types";
import type {
	FormattedNumber,
	GlyphRun,
	GlyphSlot,
	NumberFormat,
} from "./digits";
import { formatDecimal, layoutGlyphs } from "./digits";
import { boxPolyline, leftEdgeOf, TextLayoutNode } from "./text-layout";

/**
 * What `digitStyle` is asked about. One entry per drawn character.
 *
 * @category Text & numbers
 */
export interface DigitSlot {
	/** Position in the formatted string: `text()` on the node. */
	index: number;
	char: string;
	kind: GlyphSlot["kind"];
	/** 0 for the units column, 1 for tens, −1 for tenths; absent otherwise. */
	place?: number;
}

/**
 * Per-character overrides. Everything is optional and falls back to the run.
 *
 * @category Text & numbers
 */
export interface DigitStyle {
	/** Text colour (CSS) for this character. Defaults to the number's `color`. */
	color?: ColorInput;
	/**
	 * Opacity 0..1 for this character, multiplied with the number's.
	 * @default 1
	 */
	opacity?: number;
	/** Nudge from the resting slot, in scene units, before the rotation. */
	dx?: number;
	dy?: number;
	/** Multiplies the font size. The slot keeps its width. */
	scale?: number;
}

/** @category Text & numbers */
export interface DecimalNumberProps extends NumberFormat {
	/** The number to show. Bind it to a `track` to count up or down. */
	value: number;
	/**
	 * Anchor x.
	 * @default 0
	 */
	x?: number;
	/**
	 * Anchor y.
	 * @default 0
	 */
	y?: number;
	/** In scene units. Defaults to the theme's font size. */
	fontSize?: number;
	/**
	 * Text colour (CSS). Defaults to the theme foreground. Text takes a single
	 * `color`, not `fill`/`stroke`.
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
	 * Italic digits.
	 * @default false
	 */
	italic?: boolean;
	/**
	 * Where the anchor sits along the run. Centred by default, like `label`
	 * ({@link variable} is the exception and defaults to `"left"`).
	 * @default `"center"`
	 */
	align?: CanvasTextAlign;
	/**
	 * Vertical alignment relative to the anchor.
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
	 * Opacity 0..1, multiplied with enclosing groups.
	 * @default 1
	 */
	opacity?: number;
	/**
	 * Digits share the widest digit's advance, so the number does not shimmer
	 * as it ticks. Defaults to true; turn it off for a static number set in
	 * running prose, where proportional spacing reads better.
	 */
	tabular?: boolean;
	/**
	 * Hold this many integer columns open with blank slots.
	 *
	 * This is the other half of Manim's `edge_to_fix`, and the half anchoring
	 * cannot do: `align` stops the run's *ends* moving, but a counter that
	 * grows from 9 to 10 still changes width. Reserving the columns makes the
	 * width constant, so a centred counter is genuinely still.
	 */
	minIntegerDigits?: number;
	/** Reserve a sign column even when the value is positive. Same reason. */
	reserveSign?: boolean;
	/**
	 * Left-to-right reveal, 0..1, spent across the run by width, so `write()`
	 * on a number wipes the whole thing once rather than each digit in turn.
	 */
	progress?: number;
	/**
	 * Paint order; higher draws later.
	 * @default 0
	 */
	zIndex?: number;
	/**
	 * `false` hides the number.
	 * @default true
	 */
	visible?: boolean;
	/** Called per drawn character. Must be pure: its result is cached with the layout. */
	digitStyle?: (slot: DigitSlot) => DigitStyle | undefined;
}

/**
 * An offset along the run, in scene units, placed relative to the anchor.
 *
 * The run is rotated about its anchor, so a slot's along-run offset becomes a
 * displacement in the rotated direction; scene y is up, hence the plain sine.
 */
function alongRun(
	x: number,
	y: number,
	dAlong: number,
	dAcross: number,
	rotation: number,
): Point {
	if (!rotation) return { x: x + dAlong, y: y + dAcross };
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	return {
		x: x + dAlong * cos - dAcross * sin,
		y: y + dAlong * sin + dAcross * cos,
	};
}

/** One character's resolved placement, in scene units relative to the anchor. */
interface PlacedGlyph {
	slot: GlyphSlot;
	/** Along the run, from the anchor. */
	along: number;
	across: number;
	fontSize: number;
	color: string;
	opacity: number;
	/** This character's own share of the run's reveal. */
	progress: number;
}

/** Two placements that draw the same: the glyph keeps the old one and its spec. */
function sameGlyph(a: PlacedGlyph, b: PlacedGlyph): boolean {
	return (
		a.along === b.along &&
		a.across === b.across &&
		a.fontSize === b.fontSize &&
		a.color === b.color &&
		a.opacity === b.opacity &&
		a.progress === b.progress &&
		a.slot.index === b.slot.index &&
		a.slot.char === b.slot.char &&
		a.slot.kind === b.slot.kind &&
		a.slot.advance === b.slot.advance &&
		a.slot.center === b.slot.center &&
		a.slot.place === b.slot.place
	);
}

/** Two formatting results with the same fields. */
function sameFormatted(a: FormattedNumber, b: FormattedNumber): boolean {
	return (
		a.text === b.text &&
		a.numericEnd === b.numericEnd &&
		a.integerDigits === b.integerDigits &&
		a.hasSign === b.hasSign
	);
}

/** `formatDecimal` over a node's props, keeping the last result while it is equal. */
function lastFormatted(): (
	props: Readonly<NumberFormat>,
	value: number,
) => FormattedNumber {
	let last: FormattedNumber | null = null;
	return (props, value) => {
		const next = formatDecimal(value, {
			decimalPlaces: props.decimalPlaces,
			sign: props.sign,
			unit: props.unit,
			ellipsis: props.ellipsis,
			groupDigits: props.groupDigits,
			groupSeparator: props.groupSeparator,
			decimalSeparator: props.decimalSeparator,
			minusSign: props.minusSign,
		});
		if (last && sameFormatted(last, next)) return last;
		last = next;
		return next;
	};
}

/* ------------------------------------------------------------------ glyph */

/** What the number hands each of its glyph nodes. */
interface GlyphProps {
	glyph?: PlacedGlyph;
	/** The run's style; the glyph overrides colour, size and opacity. */
	style?: TextStyle;
	x?: number;
	y?: number;
	rotation?: number;
	zIndex?: number;
}

/**
 * One character, one node. Not hit-testable on its own: the number is one
 * object, not its glyphs.
 */
class GlyphNode extends BaseNode<GlyphProps> {
	override readonly producesSpec = true;

	private readonly styleOf = memo(
		(style: TextStyle, color: string, fontSize: number, opacity: number) => ({
			...style,
			fill: color,
			fontSize,
			opacity,
			// The run's spacing lives between slots, not inside them.
			letterSpacing: 0,
		}),
	);
	private readonly specOf = memo(
		(
			glyph: PlacedGlyph | undefined,
			style: TextStyle | undefined,
			x: number,
			y: number,
			rotation: number,
			zIndex: number,
			matrix: Matrix,
			clip: readonly ClipRegion[] | undefined,
		): TextSpec | null => {
			if (!glyph || !style || glyph.opacity <= 0) return null;
			const at = alongRun(x, y, glyph.along, glyph.across, rotation);
			return {
				kind: "text",
				id: this.id,
				zIndex,
				text: glyph.slot.char,
				at: applyToPoint(matrix, at),
				// Scene-space baseline angle; the renderer maps it through the view.
				rotation: textRotation(matrix, rotation),
				style: this.styleOf(style, glyph.color, glyph.fontSize, glyph.opacity),
				progress: glyph.progress,
				...clipOf({ clip }),
			};
		},
	);

	protected run(_dirty: InvalidateBits): void {
		const props = this.props;
		const space = this.space;
		this.publish(
			this.specOf(
				props.glyph,
				props.style,
				props.x ?? 0,
				props.y ?? 0,
				props.rotation ?? 0,
				props.zIndex ?? 0,
				space.matrix,
				space.clip,
			),
		);
	}

	protected override stagesForSpace(change: number): InvalidateBits {
		return change & (SpaceChange.MATRIX | SpaceChange.CLIP)
			? Invalidate.SPEC
			: 0;
	}

	/** @internal Never joins the interaction registry, even inside an `interactionGroup`. */
	override wantsInteraction(): boolean {
		return false;
	}
}

/** The glyph kind. Not exported from the package: only numbers make glyphs. */
const glyph: Definition<GlyphProps, GlyphNode> = definePrimitive<
	GlyphProps,
	GlyphNode
>({
	name: "Glyph",
	props: {
		glyph: { invalidates: Invalidate.SPEC },
		style: { invalidates: Invalidate.SPEC },
		x: { default: 0, invalidates: Invalidate.SPEC },
		y: { default: 0, invalidates: Invalidate.SPEC },
		rotation: { default: 0, invalidates: Invalidate.SPEC },
		zIndex: { default: 0, invalidates: Invalidate.SPEC },
	},
	node: (definition) => new GlyphNode(definition),
});

/* --------------------------------------------------------- decimal number */

/**
 * A `decimalNumber` (or `integer`) node: the number's handle (`bounds()`,
 * `pointAt(...)`, ...) is its run's box, and it adds the formatted text and
 * each character's box.
 *
 * @category Text & numbers
 */
export class DecimalNumberNode<
	P extends IntegerProps = DecimalNumberProps,
> extends TextLayoutNode<P> {
	/** Overrides the `decimalPlaces` prop (`integer` fixes it at 0). */
	private readonly fixedDecimalPlaces: number | undefined;

	private formatted: FormattedNumber | null = null;
	private glyphRun: GlyphRun | null = null;
	private placed: readonly PlacedGlyph[] = [];
	private style: TextStyle | null = null;
	private left = 0;
	private perUnit = 1;
	private glyphNodes: GlyphNode[] = [];

	private readonly formatOf = lastFormatted();
	private readonly styleOf = memo(
		(
			color: ColorInput | undefined,
			fontSize: number | undefined,
			fontFamily: string | undefined,
			fontWeight: string | number | undefined,
			italic: boolean | undefined,
			baseline: CanvasTextBaseline | undefined,
			opacity: number | undefined,
			letterSpacing: number | undefined,
			theme: Theme,
			scale: number,
			spaceOpacity: number,
		): TextStyle =>
			bakeTextStyle(
				{
					fill: color,
					fontSize,
					fontFamily,
					fontWeight,
					italic,
					align: "center",
					baseline,
					opacity,
					letterSpacing,
				},
				theme,
				scale,
				spaceOpacity,
			),
	);
	private readonly runOf = memo(
		(
			formatted: FormattedNumber,
			style: TextStyle,
			tabular: boolean | undefined,
			minIntegerDigits: number | undefined,
			reserveSign: boolean | undefined,
			decimalSeparator: string | undefined,
			minusSign: string | undefined,
			_fontEpoch: number,
		): GlyphRun =>
			layoutGlyphs(formatted.text, style, {
				tabular,
				padDigits: Math.max(
					0,
					(minIntegerDigits ?? 0) - formatted.integerDigits,
				),
				padSign: (reserveSign ?? false) && !formatted.hasSign,
				numericEnd: formatted.numericEnd,
				decimalSeparator,
				minusSign,
			}),
	);
	private readonly placedOf = memo(
		(
			visible: boolean | undefined,
			progress: number | undefined,
			current: GlyphRun,
			base: TextStyle,
			scale: number,
			edge: number,
			digitStyle: DecimalNumberProps["digitStyle"],
		): PlacedGlyph[] => {
			if (visible === false) return [];
			const reveal = Math.min(1, progress ?? 1);
			if (reveal <= 0) return [];

			const revealed = current.width * reveal;
			const out: PlacedGlyph[] = [];

			for (const slot of current.slots) {
				if (slot.char === "") continue;
				const start = slot.center - slot.advance / 2;
				const share =
					slot.advance <= 0
						? 1
						: progressIn(revealed, start, start + slot.advance);
				if (share <= 0) continue;

				const override = digitStyle?.({
					index: slot.index,
					char: slot.char,
					kind: slot.kind,
					place: slot.place,
				});

				out.push({
					slot,
					along: (edge + slot.center) / scale + (override?.dx ?? 0),
					across: override?.dy ?? 0,
					fontSize: base.fontSize * (override?.scale ?? 1),
					color: cssColor(override?.color ?? base.fill),
					opacity: base.opacity * (override?.opacity ?? 1),
					progress: share,
				});
			}

			return out;
		},
	);
	private readonly outlineOf = memo(
		(
			text: string,
			style: TextStyle,
			yUp: boolean,
			perUnit: number,
			left: number,
			width: number,
			_fontEpoch: number,
		): Polyline[] => {
			const box = labelBox(text, style, yUp);
			return [
				boxPolyline(
					left / perUnit,
					box.minY / perUnit,
					(left + width) / perUnit,
					box.maxY / perUnit,
				),
			];
		},
	);
	private readonly matrixOf = lastMatrix();

	constructor(definition: Definition<P>, fixedDecimalPlaces?: number) {
		super(definition);
		this.fixedDecimalPlaces = fixedDecimalPlaces;
	}

	protected layout(): readonly SceneNode[] {
		const props = this.props;
		const space = this.space;
		const scale = scaleFactorOf(space.matrix);
		const style = this.styleOf(
			props.color,
			props.fontSize,
			props.fontFamily,
			props.fontWeight,
			props.italic,
			props.baseline,
			props.opacity,
			props.letterSpacing,
			this.context(themeContext),
			scale,
			space.opacity,
		);
		const formatted = this.formatOf(
			this.fixedDecimalPlaces === undefined
				? props
				: { ...props, decimalPlaces: this.fixedDecimalPlaces },
			props.value,
		);
		const current = this.runOf(
			formatted,
			style,
			props.tabular,
			props.minIntegerDigits,
			props.reserveSign,
			props.decimalSeparator,
			props.minusSign,
			fontLoads.peek(),
		);
		const perUnit = scale || 1;
		const left = leftEdgeOf(current.width, props.align ?? "center");
		const placed = this.placedOf(
			props.visible,
			props.progress,
			current,
			style,
			perUnit,
			left,
			props.digitStyle,
		);

		this.style = style;
		this.formatted = formatted;
		this.glyphRun = current;
		this.perUnit = perUnit;
		this.left = left;
		this.placed = placed;
		return this.placeGlyphs(placed, style);
	}

	/**
	 * One glyph node per placed character, keyed by position: the node for
	 * column three stays the node for column three and only its spec changes,
	 * so a ticking number tears nothing down.
	 */
	private placeGlyphs(
		placed: readonly PlacedGlyph[],
		style: TextStyle,
	): readonly SceneNode[] {
		const props = this.props;
		let nodes = this.glyphNodes;
		if (nodes.length !== placed.length) {
			nodes = nodes.slice(0, placed.length);
			this.glyphNodes = nodes;
		}
		for (let i = 0; i < placed.length; i++) {
			const next = placed[i] as PlacedGlyph;
			let node = nodes[i];
			if (!node) {
				node = glyph.create();
				nodes[i] = node;
			}
			const previous = node.get("glyph");
			node.update({
				glyph: previous && sameGlyph(previous, next) ? previous : next,
				style,
				x: props.x ?? 0,
				y: props.y ?? 0,
				rotation: props.rotation ?? 0,
				zIndex: props.zIndex ?? 0,
			});
		}
		return nodes;
	}

	/* ----------------------------------------------------------- handles */

	/**
	 * The run's box in local units: the advance of every slot (reserved ones
	 * included) along, the measured text's extent across, oriented for `yUp`.
	 */
	protected localOutline(): readonly Polyline[] | null {
		const formatted = this.formatted;
		const current = this.glyphRun;
		const style = this.style;
		if (!formatted || !current || !style) return null;
		return this.outlineOf(
			formatted.text,
			style,
			this.space.yUp,
			this.perUnit,
			this.left,
			current.width,
			fontLoads.peek(),
		);
	}

	/**
	 * Exactly `label`'s derivation: the box is local geometry anchored at the
	 * origin, placed by this run's own TRS (rotation included, since a rotated
	 * run's box is not its unrotated one).
	 */
	protected localMatrix(): Matrix | null {
		const props = this.props;
		return this.matrixOf(
			fromTranslationRotationScale({
				x: props.x,
				y: props.y,
				rotation: props.rotation,
			}),
		);
	}

	/** The string as drawn, including any unit. */
	text(): string {
		this.refresh();
		return this.formatted?.text ?? "";
	}

	/**
	 * One character's box in scene units, or null if the index isn't drawn.
	 *
	 * @param index - Position in {@link DecimalNumberNode.text}.
	 */
	charBounds(index: number): Bounds | null {
		this.refresh();
		const found = this.placed.find((placed) => placed.slot.index === index);
		const outline = this.localOutline()?.[0];
		const own = this.localMatrix();
		if (!found || !outline || !own) return null;
		const minY = (outline[0] as Point).y;
		const maxY = (outline[2] as Point).y;
		const half = found.slot.advance / this.perUnit / 2;
		return boundsOfPolylines([
			applyToPolyline(
				compose(this.space.matrix, own),
				boxPolyline(
					found.along - half,
					minY + found.across,
					found.along + half,
					maxY + found.across,
				),
			),
		]);
	}

	protected override disposeContents(): void {
		super.disposeContents();
		this.glyphNodes = [];
	}
}

/** Descriptor entries for every {@link NumberFormat} key. */
const numberFormatProps: PropsDescriptor<NumberFormat> = {
	decimalPlaces: { default: 2, invalidates: Invalidate.UPDATE },
	sign: { default: false, invalidates: Invalidate.UPDATE },
	unit: { invalidates: Invalidate.UPDATE },
	ellipsis: { default: false, invalidates: Invalidate.UPDATE },
	groupDigits: { default: false, invalidates: Invalidate.UPDATE },
	groupSeparator: { default: ",", invalidates: Invalidate.UPDATE },
	decimalSeparator: { default: ".", invalidates: Invalidate.UPDATE },
	minusSign: { default: "−", invalidates: Invalidate.UPDATE },
};

/**
 * Descriptor entries for every {@link DecimalNumberProps} key.
 *
 * @category Text & numbers
 */
export const decimalNumberProps: PropsDescriptor<DecimalNumberProps> =
	Object.freeze({
		...numberFormatProps,
		value: { default: 0, invalidates: Invalidate.UPDATE },
		x: { default: 0, invalidates: Invalidate.UPDATE },
		y: { default: 0, invalidates: Invalidate.UPDATE },
		fontSize: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		fontFamily: { invalidates: Invalidate.UPDATE },
		fontWeight: { default: 500, invalidates: Invalidate.UPDATE },
		italic: { default: false, invalidates: Invalidate.UPDATE },
		align: { default: "center", invalidates: Invalidate.UPDATE },
		baseline: { default: "middle", invalidates: Invalidate.UPDATE },
		rotation: { default: 0, invalidates: Invalidate.UPDATE },
		letterSpacing: { default: 0, invalidates: Invalidate.UPDATE },
		opacity: { default: 1, invalidates: Invalidate.UPDATE },
		tabular: { default: true, invalidates: Invalidate.UPDATE },
		minIntegerDigits: { default: 0, invalidates: Invalidate.UPDATE },
		reserveSign: { default: false, invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		zIndex: { default: 0, invalidates: Invalidate.UPDATE },
		visible: { default: true, invalidates: Invalidate.UPDATE },
		digitStyle: { invalidates: Invalidate.UPDATE },
	});

/**
 * A number formatted to fixed decimal places and drawn one character per node.
 *
 * Because `value` is an ordinary prop, a counter is just a `track` driven by
 * `valueTo`. Digits share one advance width (tabular figures) so the number
 * does not shimmer as it ticks, and `align`, `minIntegerDigits` and
 * `reserveSign` control how it behaves when it gains a digit. Formatting
 * options (`decimalPlaces`, `unit`, `groupDigits`, `sign`, ...) come
 * from `NumberFormat`; `decimalPlaces` defaults to 2. The node's handle is
 * the run's box; `text()` and `charBounds(index)` give the formatted string
 * and one character's box.
 *
 * @example
 * ```ts
 * import { createScene, decimalNumber, track } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const value = track(0);
 * const counter = scene.add(decimalNumber.create({ value, unit: " m", minIntegerDigits: 2 }));
 * value.set(12.5); // "12.50 m", without the run changing width
 * counter.charBounds(0); // the tens digit's box
 * ```
 *
 * @see {@link integer}
 * @see {@link variable}
 *
 * @category Text & numbers
 */
export const decimalNumber: Definition<DecimalNumberProps, DecimalNumberNode> =
	definePrimitive<DecimalNumberProps, DecimalNumberNode>({
		name: "DecimalNumber",
		props: decimalNumberProps,
		node: (definition) => new DecimalNumberNode(definition),
	});

/**
 * Props for {@link integer}: {@link DecimalNumberProps} without `decimalPlaces`.
 *
 * @category Text & numbers
 */
export type IntegerProps = Omit<DecimalNumberProps, "decimalPlaces">;

const { decimalPlaces: _decimalPlaces, ...integerProps } = decimalNumberProps;

/**
 * A {@link decimalNumber} with no fractional part. Manim's `Integer`.
 *
 * @example
 * ```ts
 * import { createScene, integer } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.add(integer.create({ value: 42, groupDigits: true }));
 * ```
 *
 * @category Text & numbers
 */
export const integer: Definition<
	IntegerProps,
	DecimalNumberNode<IntegerProps>
> = definePrimitive<IntegerProps, DecimalNumberNode<IntegerProps>>({
	name: "Integer",
	props: Object.freeze(integerProps),
	node: (definition) => new DecimalNumberNode(definition, 0),
});

/* --------------------------------------------------------------- variable */

/** @category Text & numbers */
export interface VariableProps extends DecimalNumberProps {
	/**
	 * Where the anchor sits along the whole line. Left by default (Manim's
	 * `edge_to_fix=LEFT`), unlike `label` / `decimalNumber`, which centre: the
	 * name is the fixed edge and the number grows to its right.
	 * @default `"left"`
	 */
	align?: CanvasTextAlign;
	/** The name on the left. Plain text; a LaTeX name is `@sophistry/text`'s. */
	label: string;
	/** Defaults to `=`. Any relation: `≈`, `≤`, `→`. */
	relation?: string;
	/**
	 * Gap either side of the relation.
	 * @default 0.18
	 */
	gap?: number;
	/** Colour of the name and relation. Defaults to the number's colour. */
	labelColor?: ColorInput;
	/** Variable names are italic in maths setting, so this defaults to true. */
	labelItalic?: boolean;
}

const DEFAULT_RELATION_GAP = 0.18;

/** The three parts' offsets and widths along the line, in local units. */
interface VariableParts {
	total: number;
	label: { at: number; width: number };
	relation: { at: number; width: number };
	number: { at: number; width: number };
}

/**
 * A `variable` node: its handle is the whole line's box, and `text()` the
 * whole line as drawn.
 *
 * @category Text & numbers
 */
export class VariableNode extends TextLayoutNode<VariableProps> {
	private parts: VariableParts | null = null;
	private formatted: FormattedNumber | null = null;
	private textStyle: BoxStyle | null = null;
	private nameNode: TextNode<LabelProps> | null = null;
	private relationNode: TextNode<LabelProps> | null = null;
	private numberNode: DecimalNumberNode | null = null;
	private shown: readonly SceneNode[] = [];

	private readonly formatOf = lastFormatted();
	private readonly textStyleOf = memo(
		(
			fontSize: number,
			fontFamily: string | undefined,
			fontWeight: string | number | undefined,
			labelItalic: boolean | undefined,
			baseline: CanvasTextBaseline | undefined,
			theme: Theme,
			perUnit: number,
		) => ({
			...bakeTextFont(
				{ fontSize, fontFamily, fontWeight, italic: labelItalic ?? true },
				theme,
				perUnit,
			),
			align: "left" as CanvasTextAlign,
			baseline: baseline ?? ("middle" as CanvasTextBaseline),
		}),
	);
	private readonly partsOf = memo(
		(
			name: string,
			relation: string,
			formatted: FormattedNumber,
			style: BoxStyle,
			perUnit: number,
			tabular: boolean | undefined,
			minIntegerDigits: number | undefined,
			reserveSign: boolean | undefined,
			decimalSeparator: string | undefined,
			minusSign: string | undefined,
			gap: number,
			align: CanvasTextAlign,
			_fontEpoch: number,
		): VariableParts => {
			const labelWidth = labelBox(name, style).maxX / perUnit;
			const relationWidth =
				labelBox(relation, { ...style, italic: false }).maxX / perUnit;
			const numberWidth =
				layoutGlyphs(formatted.text, style, {
					tabular,
					padDigits: Math.max(
						0,
						(minIntegerDigits ?? 0) - formatted.integerDigits,
					),
					padSign: (reserveSign ?? false) && !formatted.hasSign,
					numericEnd: formatted.numericEnd,
					decimalSeparator,
					minusSign,
				}).width / perUnit;

			const total = labelWidth + gap + relationWidth + gap + numberWidth;
			const left = leftEdgeOf(total, align);

			return {
				total,
				label: { at: left, width: labelWidth },
				relation: { at: left + labelWidth + gap, width: relationWidth },
				number: {
					at: left + labelWidth + gap + relationWidth + gap,
					width: numberWidth,
				},
			};
		},
	);
	private readonly outlineOf = memo(
		(
			text: string,
			style: BoxStyle,
			yUp: boolean,
			perUnit: number,
			total: number,
			align: CanvasTextAlign,
			_fontEpoch: number,
		): Polyline[] => {
			const box = labelBox(text, style, yUp);
			const minX = leftEdgeOf(total, align);
			return [
				boxPolyline(minX, box.minY / perUnit, minX + total, box.maxY / perUnit),
			];
		},
	);
	private readonly matrixOf = lastMatrix();

	protected layout(): readonly SceneNode[] {
		const props = this.props;
		const theme = this.context(themeContext);
		const perUnit = scaleFactorOf(this.space.matrix) || 1;
		const fontSize = props.fontSize ?? theme.defaults.fontSize;
		const color = props.color ?? theme.palette.foreground;
		const relation = props.relation ?? "=";
		const align = props.align ?? "left";

		const textStyle = this.textStyleOf(
			fontSize,
			props.fontFamily,
			props.fontWeight,
			props.labelItalic,
			props.baseline,
			theme,
			perUnit,
		);
		const formatted = this.formatOf(props, props.value);
		const parts = this.partsOf(
			props.label ?? "",
			relation,
			formatted,
			textStyle,
			perUnit,
			props.tabular,
			props.minIntegerDigits,
			props.reserveSign,
			props.decimalSeparator,
			props.minusSign,
			props.gap ?? DEFAULT_RELATION_GAP,
			align,
			fontLoads.peek(),
		);
		this.textStyle = textStyle;
		this.formatted = formatted;
		this.parts = parts;

		if (props.visible === false) {
			this.nameNode = null;
			this.relationNode = null;
			this.numberNode = null;
			this.shown = [];
			return this.shown;
		}

		/** Each part's share of one left-to-right reveal across the whole line. */
		const share = (from: number, width: number): number => {
			const revealed = parts.total * Math.min(1, props.progress ?? 1);
			const start = from - parts.label.at;
			if (width <= 0) return 1;
			return progressIn(revealed, start, start + width);
		};
		const anchorFor = (along: number): Point =>
			alongRun(props.x ?? 0, props.y ?? 0, along, 0, props.rotation ?? 0);

		const labelAt = anchorFor(parts.label.at);
		const relationAt = anchorFor(parts.relation.at);
		const numberAt = anchorFor(parts.number.at);
		const nameColor = props.labelColor ?? color;

		this.nameNode ??= label.create({ text: "" });
		const nameNode = this.nameNode;
		nameNode.update({
			text: props.label ?? "",
			x: labelAt.x,
			y: labelAt.y,
			align: "left",
			baseline: props.baseline,
			fontSize,
			fontFamily: props.fontFamily,
			fontWeight: props.fontWeight,
			italic: props.labelItalic ?? true,
			color: nameColor,
			rotation: props.rotation,
			opacity: props.opacity,
			zIndex: props.zIndex,
			progress: share(parts.label.at, parts.label.width),
		});
		this.relationNode ??= label.create({ text: "" });
		const relationNode = this.relationNode;
		relationNode.update({
			text: relation,
			x: relationAt.x,
			y: relationAt.y,
			align: "left",
			baseline: props.baseline,
			fontSize,
			fontFamily: props.fontFamily,
			fontWeight: props.fontWeight,
			color: nameColor,
			rotation: props.rotation,
			opacity: props.opacity,
			zIndex: props.zIndex,
			progress: share(parts.relation.at, parts.relation.width),
		});
		this.numberNode ??= decimalNumber.create({ value: 0 });
		const numberNode = this.numberNode;
		numberNode.update({
			// Everything the number shares with the line...
			value: props.value,
			decimalPlaces: props.decimalPlaces,
			sign: props.sign,
			unit: props.unit,
			ellipsis: props.ellipsis,
			groupDigits: props.groupDigits,
			groupSeparator: props.groupSeparator,
			decimalSeparator: props.decimalSeparator,
			minusSign: props.minusSign,
			fontSize: props.fontSize,
			fontFamily: props.fontFamily,
			fontWeight: props.fontWeight,
			baseline: props.baseline,
			rotation: props.rotation,
			letterSpacing: props.letterSpacing,
			opacity: props.opacity,
			tabular: props.tabular,
			minIntegerDigits: props.minIntegerDigits,
			reserveSign: props.reserveSign,
			zIndex: props.zIndex,
			visible: props.visible,
			digitStyle: props.digitStyle,
			// ...and what it is told.
			x: numberAt.x,
			y: numberAt.y,
			align: "left",
			color,
			italic: props.italic,
			progress: share(parts.number.at, parts.number.width),
		});

		if (this.shown.length === 0)
			this.shown = [nameNode, relationNode, numberNode];
		return this.shown;
	}

	/* ----------------------------------------------------------- handles */

	/** The whole line's box in local units, oriented for `yUp`. */
	protected localOutline(): readonly Polyline[] | null {
		const formatted = this.formatted;
		const style = this.textStyle;
		const parts = this.parts;
		if (!formatted || !style || !parts) return null;
		return this.outlineOf(
			formatted.text,
			style,
			this.space.yUp,
			scaleFactorOf(this.space.matrix) || 1,
			parts.total,
			this.props.align ?? "left",
			fontLoads.peek(),
		);
	}

	protected localMatrix(): Matrix | null {
		const props = this.props;
		return this.matrixOf(
			fromTranslationRotationScale({
				x: props.x,
				y: props.y,
				rotation: props.rotation,
			}),
		);
	}

	/** The whole line as drawn, `"x = 3.00"`. */
	text(): string {
		this.refresh();
		return `${this.props.label ?? ""} ${this.props.relation ?? "="} ${this.formatted?.text ?? ""}`;
	}

	protected override disposeContents(): void {
		super.disposeContents();
		this.nameNode = null;
		this.relationNode = null;
		this.numberNode = null;
		this.shown = [];
	}
}

/**
 * Descriptor entries for every {@link VariableProps} key.
 *
 * @category Text & numbers
 */
export const variableProps: PropsDescriptor<VariableProps> = Object.freeze({
	...decimalNumberProps,
	align: { default: "left", invalidates: Invalidate.UPDATE },
	label: { default: "", invalidates: Invalidate.UPDATE },
	relation: { default: "=", invalidates: Invalidate.UPDATE },
	gap: { default: DEFAULT_RELATION_GAP, invalidates: Invalidate.UPDATE },
	labelColor: { invalidates: Invalidate.UPDATE },
	labelItalic: { default: true, invalidates: Invalidate.UPDATE },
});

/**
 * `label = value`: Manim's `Variable`.
 *
 * Composed rather than built: two `label`s and a `decimalNumber`, placed off
 * their own measured widths. The reveal is spent across the three parts by
 * width, so `write()` wipes the line once instead of three times.
 *
 * It defaults to `align: "left"`, which is Manim's `edge_to_fix=LEFT` and the
 * right default here: the name is the fixed thing a reader's eye returns to,
 * and the number grows to the right of it. Centre it and give the number a
 * `minIntegerDigits` if you want it centred and still.
 *
 * Accepts every {@link DecimalNumberProps} field; `x`/`y` anchor the whole
 * line, and the node's handle is the whole line's box.
 *
 * @example
 * ```ts
 * import { createScene, track, variable } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const t = track(0);
 * scene.add(variable.create({ label: "t", value: t, decimalPlaces: 1, x: -3 }));
 * ```
 *
 * @category Text & numbers
 */
export const variable: Definition<VariableProps, VariableNode> =
	definePrimitive<VariableProps, VariableNode>({
		name: "Variable",
		props: variableProps,
		node: (definition) => new VariableNode(definition),
	});
