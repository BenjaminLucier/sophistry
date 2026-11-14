/**
 * `box`: a rectangle laid out with flexbox, painted with a background and a
 * border, holding text, other boxes and any scene node.
 *
 * Only the outermost box of a tree lays out. It builds one layout tree from
 * itself, every box nested directly inside it (and inside those), and the
 * leaves (text, which wraps; any other node, which keeps its measured size),
 * computes it with `@sophistry/layout`, and hands each box its result. Every
 * box then places its own children: it gives each a space of its own
 * (`childSpaceFor`), so a child moves without being wrapped in anything.
 *
 * Inside a box, numbers are design pixels (or scene units with
 * `lengthUnit: "scene"`) and y runs down, as on a page. The outermost box is
 * centred on its `x`/`y`, which are in its parent's units like any node's.
 * Scene nodes inside keep scene units and their own y direction: their cell
 * is scaled back, so an `axes` means the same inside a box as outside.
 */

import type {
	ContextKey,
	InheritedTextStyle,
	InvalidateBits,
	LengthUnit,
	SceneNode,
	ShapeNode,
	Space,
} from "@sophistry/core";
import {
	definePrimitive,
	fontEpochContext,
	frameContext,
	Invalidate,
	pixelsPerUnitContext,
	rect,
	SpaceChange,
	TextNode,
	textStyleContext,
	themeContext,
} from "@sophistry/core";
import type {
	Bounds,
	CornerRadius,
	Matrix,
	Point,
} from "@sophistry/core/geometry";
import {
	applyToPoint,
	boundsOf,
	compose,
	fromTranslationRotationScale,
	invert,
	scaleFactorOf,
	scale as scaleMatrix,
	translate,
} from "@sophistry/core/geometry";
import type { SceneGraph } from "@sophistry/core/internal";
import {
	ANY_CONTEXT,
	BaseContainer,
	type BaseNode,
	nestClip,
	watchFontLoads,
} from "@sophistry/core/internal";
import type { LayoutBox, LayoutNode, MeasureFunction } from "@sophistry/layout";
import { computeLayout } from "@sophistry/layout";
import type { BorderProps } from "./paint.js";
import { boxBorder, cornerList, frameRadii } from "./paint.js";
import type { BoxStyle } from "./style.js";
import { layoutStyleOf } from "./style.js";

/** @category Box */
export interface BoxProps {
	/**
	 * Centre x of the outermost box, in its parent's units. Ignored on a box
	 * inside another, which its parent places.
	 * @default 0
	 */
	x?: number;
	/**
	 * Centre y of the outermost box, in its parent's units.
	 * @default 0
	 */
	y?: number;
	/** Turns the outermost box about its centre, in radians. Never affects layout. */
	rotation?: number;
	/**
	 * Scales the outermost box about its centre. Never affects layout.
	 * @default 1
	 */
	scale?: number;
	/**
	 * What the style's numbers are: `"px"` for design pixels (a scene is
	 * 1920 wide), `"scene"` for scene units. Text inside takes the same unit.
	 * @default "px"
	 */
	lengthUnit?: LengthUnit;
	/** Layout, paint and text style. */
	style?: BoxStyle;
	/** Text, boxes and scene nodes, laid out in order. */
	children?: readonly SceneNode[];
}

const ZERO_BOX: LayoutBox = {
	x: 0,
	y: 0,
	width: 0,
	height: 0,
	margin: { top: 0, right: 0, bottom: 0, left: 0 },
	padding: { top: 0, right: 0, bottom: 0, left: 0 },
	border: { top: 0, right: 0, bottom: 0, left: 0 },
	children: [],
};

/** The smallest wrap width: every break taken, for a min-content size. */
const NARROWEST = 1e-6;

const TEXT_KEYS = [
	"color",
	"fontFamily",
	"fontSize",
	"fontWeight",
	"italic",
	"letterSpacing",
	"lineHeight",
	"textAlign",
	"underline",
	"strikethrough",
] as const satisfies readonly (keyof InheritedTextStyle & keyof BoxStyle)[];

function sameBox(a: LayoutBox | undefined, b: LayoutBox): boolean {
	return (
		a !== undefined &&
		a.x === b.x &&
		a.y === b.y &&
		a.width === b.width &&
		a.height === b.height
	);
}

function spaceChange(previous: Space | undefined, next: Space): number {
	if (!previous) return SpaceChange.ALL;
	let change = 0;
	if (previous.matrix !== next.matrix) change |= SpaceChange.MATRIX;
	if (previous.opacity !== next.opacity) change |= SpaceChange.OPACITY;
	if (previous.clip !== next.clip) change |= SpaceChange.CLIP;
	if (previous.penScale !== next.penScale) change |= SpaceChange.PEN_SCALE;
	if (previous.yUp !== next.yUp) change |= SpaceChange.Y_UP;
	if (previous.lengthScale !== next.lengthScale) {
		change |= SpaceChange.LENGTH_SCALE;
	}
	return change;
}

/** The parts of a node that say where it is in its own units. */
interface Outlined {
	localOutline(): readonly Point[][] | null;
	localMatrix(): Matrix | null;
}

/**
 * A node's box in its own units: its outline under its own transform, not
 * the space it is in (which the box is about to set). A container has no
 * outline of its own: its scene box is taken back through its space.
 */
function ownBounds(node: BaseNode): Bounds | null {
	node.refresh();
	const outlined = node as unknown as Outlined;
	const outline = outlined.localOutline();
	if (outline) {
		const own = outlined.localMatrix();
		return boundsOf(
			outline.map((line) =>
				own ? line.map((point) => applyToPoint(own, point)) : line,
			),
		);
	}
	const scene = node.bounds();
	const inverse = invert(node.space.matrix);
	if (!scene || !inverse) return null;
	return boundsOf([
		[
			applyToPoint(inverse, { x: scene.minX, y: scene.minY }),
			applyToPoint(inverse, { x: scene.maxX, y: scene.minY }),
			applyToPoint(inverse, { x: scene.maxX, y: scene.maxY }),
			applyToPoint(inverse, { x: scene.minX, y: scene.maxY }),
		],
	]);
}

/** Whether two boxes are the same, to rounding. */
function sameBounds(a: Bounds | null, b: Bounds | null): boolean {
	if (!a || !b) return a === b;
	const close = (x: number, y: number) => Math.abs(x - y) <= 1e-9;
	return (
		close(a.minX, b.minX) &&
		close(a.minY, b.minY) &&
		close(a.maxX, b.maxX) &&
		close(a.maxY, b.maxY)
	);
}

function sameMatrix(a: Matrix, b: Matrix): boolean {
	return (
		a.a === b.a &&
		a.b === b.b &&
		a.c === b.c &&
		a.d === b.d &&
		a.e === b.e &&
		a.f === b.f
	);
}

/**
 * A box node.
 *
 * @category Box
 */
export class BoxNode extends BaseContainer<BoxProps> {
	/** This box's result, relative to its parent box (the root's: to its own margin). */
	private layoutBox: LayoutBox = ZERO_BOX;
	/** Each laid-out child's box, relative to this box's border box. */
	private childBoxes = new Map<BaseNode, LayoutBox>();
	/** Scene nodes' measured boxes, in their own units, as of the last layout. */
	private leafBounds = new Map<BaseNode, Bounds | null>();
	/** The space each child was handed, as of the last placement. */
	private spaces = new Map<BaseNode, Space>();
	/** The border box's frame: origin at its top left, y down, to scene units. */
	private frame: Matrix | null = null;
	private background: ReturnType<typeof rect.create> | null = null;
	private border: ShapeNode<BorderProps> | null = null;
	private textStyle: InheritedTextStyle | null = null;
	/** Set while the root lays out, so measuring text does not ask it to again. */
	private laying = false;

	/* ----------------------------------------------------------- children */

	/** The children as given: paint nodes are not among them. */
	override get children(): readonly SceneNode[] {
		return this.contentNodes();
	}

	private paintNodes(): BaseNode[] {
		const nodes: BaseNode[] = [];
		if (this.background) nodes.push(this.background as unknown as BaseNode);
		if (this.border) nodes.push(this.border as unknown as BaseNode);
		return nodes;
	}

	private isPaint(node: BaseNode): boolean {
		return (
			node === (this.background as unknown as BaseNode) ||
			node === (this.border as unknown as BaseNode)
		);
	}

	private contentNodes(): BaseNode[] {
		return this.childNodes.filter((node) => !this.isPaint(node));
	}

	override setChildren(children: readonly SceneNode[]): void {
		super.setChildren([...this.paintNodes(), ...children]);
		this.relayout();
	}

	override add<N extends SceneNode>(
		child: N,
		before: SceneNode | null = null,
	): N {
		super.add(child, before);
		this.relayout();
		return child;
	}

	override release(node: BaseNode): void {
		super.release(node);
		this.spaces.delete(node);
		this.childBoxes.delete(node);
		this.leafBounds.delete(node);
		if (node instanceof TextNode) node.setLayoutWidth(undefined);
		if (!this.isPaint(node)) this.relayout();
	}

	/** A text child's content or style changed: its size may have. */
	override childContentChanged(_child: BaseNode): void {
		if (!this.root().laying) this.relayout();
	}

	/** Scene nodes inside are sized by their bounds, so a box hears them change. */
	override get watchesChildGeometry(): boolean {
		return true;
	}

	/**
	 * A scene node inside ran its geometry or transform again (or something
	 * inside it did): lay out again if its box is not the one laid out (its
	 * size sizes its cell, and its corner places it there).
	 * Boxes and text say so through the layout itself.
	 */
	override childGeometryChanged(child: BaseNode): void {
		if (
			child instanceof BoxNode ||
			child instanceof TextNode ||
			this.isPaint(child) ||
			child.parentNode !== this ||
			this.root().laying ||
			!this.leafBounds.has(child)
		) {
			return;
		}
		const before = this.leafBounds.get(child) ?? null;
		const after = ownBounds(child);
		if (!sameBounds(before, after)) this.relayout();
	}

	/* ------------------------------------------------------------- stages */

	private root(): BoxNode {
		let node: BoxNode = this;
		while (node.parentNode instanceof BoxNode) node = node.parentNode;
		return node;
	}

	private get isRoot(): boolean {
		return !(this.parentNode instanceof BoxNode);
	}

	private relayout(): void {
		this.root().invalidate(Invalidate.UPDATE);
	}

	protected override run(dirty: InvalidateBits): void {
		if (dirty & Invalidate.STYLE) this.provideTextStyle();
		if (dirty & Invalidate.UPDATE) {
			if (this.isRoot) this.layout();
			else this.root().invalidate(Invalidate.UPDATE);
		}
		this.place();
	}

	protected override stagesForSpace(_change: number): InvalidateBits {
		return Invalidate.SPACE;
	}

	/** Recomputes its children's spaces itself rather than forwarding the change. */
	override spaceChanged(change: number): void {
		this.invalidate(this.stagesForSpace(change));
	}

	protected override stagesForContext(
		key: ContextKey<unknown>,
	): InvalidateBits {
		if (key === ANY_CONTEXT) {
			return Invalidate.UPDATE | Invalidate.STYLE | Invalidate.SPACE;
		}
		if (key === pixelsPerUnitContext)
			return Invalidate.UPDATE | Invalidate.SPACE;
		if (key === fontEpochContext) return Invalidate.UPDATE;
		if (key === themeContext || key === textStyleContext) {
			return Invalidate.STYLE;
		}
		return 0;
	}

	override reparented(): void {
		super.reparented();
		this.invalidate(Invalidate.UPDATE | Invalidate.STYLE);
	}

	override attach(graph: SceneGraph): void {
		super.attach(graph);
		if (!graph.fontWatch) watchFontLoads(graph);
	}

	/* ------------------------------------------------------------- layout */

	/** Design pixels per number in this box's style. */
	private unitPixels(): number {
		return this.props.lengthUnit === "scene"
			? this.context(pixelsPerUnitContext)
			: 1;
	}

	/** Lays the whole tree out and hands every box its part. */
	private layout(): void {
		this.laying = true;
		try {
			const boxes: BoxNode[] = [];
			const tree = this.layoutTree(boxes);
			const perUnit = this.context(pixelsPerUnitContext);
			const frame = this.context(frameContext).peek();
			const result = computeLayout(tree, {
				width: (frame.maxX - frame.minX) * perUnit,
				height: (frame.maxY - frame.minY) * perUnit,
			});
			this.applyLayout(result);
		} finally {
			this.laying = false;
		}
	}

	/** This box and everything laid out with it, as a layout tree. */
	private layoutTree(boxes: BoxNode[]): LayoutNode {
		boxes.push(this);
		const unit = this.unitPixels();
		const perSceneUnit = this.context(pixelsPerUnitContext);
		const children: LayoutNode[] = [];
		for (const child of this.contentNodes()) {
			if (child instanceof BoxNode) {
				children.push(child.layoutTree(boxes));
			} else if (child instanceof TextNode) {
				children.push({ measure: this.measureText(child, unit) });
			} else {
				const bounds = ownBounds(child);
				this.leafBounds.set(child, bounds);
				const width = bounds ? (bounds.maxX - bounds.minX) * perSceneUnit : 0;
				const height = bounds ? (bounds.maxY - bounds.minY) * perSceneUnit : 0;
				children.push({
					style: { width, height, flexShrink: 0 },
				});
			}
		}
		return {
			style: layoutStyleOf(this.props.style ?? {}, { unit, perSceneUnit }),
			children,
		};
	}

	/** Text wraps at the width it is given, else at the width available. */
	private measureText(
		text: { measure(width?: number): { width: number; height: number } },
		unit: number,
	): MeasureFunction {
		return (known, available) => {
			const width =
				known.width ??
				(typeof available.width === "number"
					? available.width
					: available.width === "min-content"
						? NARROWEST
						: undefined);
			const size = text.measure(width === undefined ? undefined : width / unit);
			return {
				width: known.width ?? size.width * unit,
				height: known.height ?? size.height * unit,
			};
		};
	}

	/** Takes this box's result, and hands its nested boxes theirs. */
	private applyLayout(result: LayoutBox): void {
		const moved = !sameBox(this.layoutBox, result);
		this.layoutBox = result;
		const unit = this.unitPixels();
		const content = this.contentNodes();
		const boxes = new Map<BaseNode, LayoutBox>();
		content.forEach((child, index) => {
			const box = result.children[index] ?? ZERO_BOX;
			const before = this.childBoxes.get(child);
			boxes.set(child, box);
			if (child instanceof BoxNode) {
				child.applyLayout(box);
			} else if (child instanceof TextNode) {
				child.setLayoutWidth(box.width / unit);
			}
			if (!sameBox(before, box)) this.invalidate(Invalidate.SPACE);
		});
		this.childBoxes = boxes;
		if (moved || this !== this.root()) this.invalidate(Invalidate.SPACE);
	}

	/* ---------------------------------------------------------- placement */

	/** Scene units per layout pixel, before the parent's own scale. */
	private pixelScale(space: Space): number {
		return 1 / this.context(pixelsPerUnitContext) / space.lengthScale;
	}

	/** The border box's frame, from the parent's space (and, at the root, its own props). */
	private frameOf(space: Space): Matrix {
		if (!this.isRoot) return space.matrix;
		const props = this.props;
		const unit = this.pixelScale(space);
		const flip = space.yUp ? -1 : 1;
		const { width, height } = this.layoutBox;
		const local = compose(
			fromTranslationRotationScale({
				x: props.x ?? 0,
				y: props.y ?? 0,
				rotation: props.rotation,
				scaleX: props.scale,
				scaleY: props.scale,
			}),
			compose(
				scaleMatrix(unit, flip * unit),
				translate(-width / 2, -height / 2),
			),
		);
		return compose(space.matrix, local);
	}

	private currentFrame(): Matrix {
		this.frame ??= this.frameOf(this.space);
		return this.frame;
	}

	override childSpaceFor(child: BaseNode): Space {
		return this.spaces.get(child) ?? this.spaceOf(child, this.currentFrame());
	}

	/** The space handed to one child, in a frame. */
	private spaceOf(child: BaseNode, frame: Matrix): Space {
		const space = this.space;
		const style = this.props.style ?? {};
		const perUnit = this.context(pixelsPerUnitContext);
		const opacity = space.opacity * (style.opacity ?? 1);
		const penScale =
			space.penScale === undefined
				? undefined
				: (space.penScale * scaleFactorOf(frame)) / scaleFactorOf(space.matrix);
		const base = { opacity, penScale, yUp: space.yUp };
		if (this.isPaint(child)) {
			return {
				...base,
				matrix: frame,
				clip: space.clip,
				lengthScale: 1 / perUnit,
			};
		}
		const clip = this.contentClip(frame);
		const box = this.childBoxes.get(child) ?? ZERO_BOX;
		if (child instanceof BoxNode) {
			return {
				...base,
				matrix: compose(frame, translate(box.x, box.y)),
				clip,
				lengthScale: 1 / perUnit,
			};
		}
		if (child instanceof TextNode) {
			const unit = this.unitPixels();
			return {
				...base,
				matrix: compose(
					frame,
					compose(translate(box.x, box.y), scaleMatrix(unit)),
				),
				clip,
				lengthScale: unit / perUnit,
			};
		}
		// A scene node keeps scene units and its own y direction: its measured
		// box's top left lands on the cell's.
		const bounds = this.leafBounds.get(child) ?? null;
		const minX = bounds?.minX ?? 0;
		const top = space.yUp ? (bounds?.maxY ?? 0) : (bounds?.minY ?? 0);
		const flip = space.yUp ? -1 : 1;
		return {
			...base,
			matrix: compose(
				frame,
				compose(
					translate(box.x - minX * perUnit, box.y - flip * top * perUnit),
					scaleMatrix(perUnit, flip * perUnit),
				),
			),
			clip,
			lengthScale: 1,
		};
	}

	private clipCache: {
		frame: Matrix;
		parent: unknown;
		clip: Space["clip"];
	} | null = null;

	/** The enclosing clip, with this box's padding box when it hides overflow. */
	private contentClip(frame: Matrix): Space["clip"] {
		const space = this.space;
		if (this.props.style?.overflow !== "hidden") return space.clip;
		const cached = this.clipCache;
		if (cached && cached.frame === frame && cached.parent === space.clip) {
			return cached.clip;
		}
		const { width, height, border } = this.layoutBox;
		const clip = nestClip(
			space.clip,
			{
				minX: border.left,
				minY: border.top,
				maxX: width - border.right,
				maxY: height - border.bottom,
			},
			frame,
		);
		this.clipCache = { frame, parent: space.clip, clip };
		return clip;
	}

	/** Places the paint and every child, telling each child what changed. */
	private place(): void {
		const next = this.frameOf(this.space);
		const frame =
			this.frame && sameMatrix(this.frame, next) ? this.frame : next;
		this.frame = frame;
		this.paint();
		const previous = this.spaces;
		this.spaces = new Map();
		for (const child of this.childNodes) {
			let space = this.spaceOf(child, frame);
			const before = previous.get(child);
			if (before && sameMatrix(before.matrix, space.matrix)) {
				space = { ...space, matrix: before.matrix };
			}
			const change = spaceChange(before, space);
			this.spaces.set(child, change === 0 && before ? before : space);
			if (change !== 0) child.spaceChanged(change);
		}
	}

	/* -------------------------------------------------------------- paint */

	/** Makes, updates or drops the background and the border. */
	private paint(): void {
		const style = this.props.style ?? {};
		const { width, height, border } = this.layoutBox;
		const unit = this.unitPixels();
		const radii = cornerList(style.borderRadius).map((radius: CornerRadius) =>
			typeof radius === "number"
				? radius * unit
				: { x: radius.x * unit, y: radius.y * unit },
		) as unknown as BorderProps["radii"];
		let structure = false;

		if (style.background !== undefined) {
			if (!this.background) {
				this.background = rect.create({ width: 0, height: 0 });
				structure = true;
			}
			this.background.update({
				center: { x: width / 2, y: height / 2 },
				width,
				height,
				cornerRadii: frameRadii(radii),
				fill: style.background,
				stroke: "none",
			} as never);
		} else if (this.background) {
			this.background = null;
			structure = true;
		}

		const bordered =
			border.top > 0 ||
			border.right > 0 ||
			border.bottom > 0 ||
			border.left > 0;
		if (bordered) {
			if (!this.border) {
				this.border = boxBorder.create({
					width: 0,
					height: 0,
					widths: border,
					radii,
				});
				structure = true;
			}
			const color =
				style.borderColor ??
				this.textStyle?.color ??
				this.context(themeContext).palette.foreground;
			this.border.update({
				width,
				height,
				widths: border,
				radii,
				fill: color,
				stroke: "none",
			});
		} else if (this.border) {
			this.border = null;
			structure = true;
		}

		if (structure) {
			// Kept first, so they paint under the contents on a z-index tie.
			super.setChildren([...this.paintNodes(), ...this.contentNodes()]);
		}
	}

	/** Hands the text inside this box's text style, over what it inherits. */
	private provideTextStyle(): void {
		const style = this.props.style ?? {};
		const inherited = this.context(textStyleContext);
		const own: InheritedTextStyle = { ...inherited };
		let any = inherited !== null;
		for (const key of TEXT_KEYS) {
			const value = style[key];
			if (value !== undefined) {
				(own as Record<string, unknown>)[key] = value;
				any = true;
			}
		}
		const next = any ? own : null;
		const previous = this.textStyle;
		if (
			previous &&
			next &&
			TEXT_KEYS.every((key) => previous[key] === next[key])
		) {
			return;
		}
		this.textStyle = next;
		this.provide(textStyleContext, next);
	}

	/* ------------------------------------------------------------ handles */

	/** The border box in scene units. */
	override bounds(): Bounds | null {
		this.refresh();
		const frame = this.currentFrame();
		const { width, height } = this.layoutBox;
		return boundsOf([
			[
				applyToPoint(frame, { x: 0, y: 0 }),
				applyToPoint(frame, { x: width, y: 0 }),
				applyToPoint(frame, { x: width, y: height }),
				applyToPoint(frame, { x: 0, y: height }),
			],
		]);
	}

	/** The border box in its parent's units. */
	override localBounds(): Bounds | null {
		this.refresh();
		const space = this.space;
		const frame = this.currentFrame();
		const { width, height } = this.layoutBox;
		// The frame relative to the parent's: undo the parent's matrix.
		const parentScale = scaleFactorOf(space.matrix) || 1;
		const corners = [
			{ x: 0, y: 0 },
			{ x: width, y: 0 },
			{ x: width, y: height },
			{ x: 0, y: height },
		].map((corner) => {
			const scene = applyToPoint(frame, corner);
			const origin = applyToPoint(space.matrix, { x: 0, y: 0 });
			return {
				x: (scene.x - origin.x) / parentScale,
				y: (scene.y - origin.y) / parentScale,
			};
		});
		return boundsOf([corners]);
	}
}

/**
 * A box laid out with flexbox, as on a web page, drawn on the canvas with
 * everything else: a background, a border with rounded corners, text that
 * wraps, other boxes and any scene node.
 *
 * The outermost box is centred on `x`/`y`. Inside, the style's numbers are
 * design pixels (a scene is 1920 wide; `lengthUnit: "scene"` switches to
 * scene units) and y runs down. Text inside takes the box's text style;
 * scene nodes keep their own units, scaled into their cell.
 *
 * @example
 * ```ts
 * import { box } from "@sophistry/box";
 * import { createScene, text } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.add(
 * 	box.create({
 * 		style: { padding: 32, gap: 16, background: "#1e2a3a", borderRadius: 24, color: "#ffffff" },
 * 		children: [
 * 			text.create({ text: "Fourier series", fontSize: 64 }),
 * 			text.create({ text: "Any periodic function is a sum of sines." }),
 * 		],
 * 	}),
 * );
 * ```
 *
 * @category Box
 */
export const box = definePrimitive<BoxProps, BoxNode>({
	name: "Box",
	container: true,
	props: {
		x: { default: 0, invalidates: Invalidate.SPACE },
		y: { default: 0, invalidates: Invalidate.SPACE },
		rotation: { default: 0, invalidates: Invalidate.SPACE },
		scale: { default: 1, invalidates: Invalidate.SPACE },
		lengthUnit: {
			default: "px",
			invalidates: Invalidate.UPDATE | Invalidate.STYLE,
		},
		style: { invalidates: Invalidate.UPDATE | Invalidate.STYLE },
		children: { kind: "children", invalidates: Invalidate.NONE },
	},
	node: (definition) => new BoxNode(definition),
});
