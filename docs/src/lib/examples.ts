/**
 * Build-time access to the example files in `src/examples/<category>/<Name>.tsx`
 * (Solid components) and `src/examples/vanilla/<Name>.ts` (plain TypeScript):
 * their `meta` and their displayable source. Shared by Example, Gallery and the
 * gallery index.
 */

export interface ExampleMeta {
	title: string;
	description: string;
	uses: string[];
}

/** Gallery categories, in display order. `dir` is the folder under `src/examples`. */
export const CATEGORIES = [
	{
		dir: "basic",
		title: "Basic concepts",
		blurb: "Stages, shapes and your first tweens.",
	},
	{
		dir: "animation",
		title: "Animations",
		blurb: "Sequencing, morphs and emphasis effects.",
	},
	{
		dir: "plotting",
		title: "Plotting and charts",
		blurb: "Axes, graphs and data-driven charts.",
	},
	{
		dir: "interaction",
		title: "Interaction",
		blurb: "Dragging, constraints and keyboard-accessible scenes.",
	},
	{
		dir: "maths",
		title: "Math and LaTeX",
		blurb: "Formulas as geometry that draws and transforms.",
	},
	{
		dir: "three-d",
		title: "3D",
		blurb: "Cameras, meshes and orbit controls projected onto the same canvas.",
	},
	{
		dir: "advanced",
		title: "Advanced projects",
		blurb: "Larger scenes that combine several features.",
	},
	{
		dir: "vanilla",
		title: "Without a framework",
		blurb:
			"The same core from plain TypeScript: createScene, definitions, tracks and play.",
	},
] as const;

export type CategoryDir = (typeof CATEGORIES)[number]["dir"];

const sources = import.meta.glob<string>("../examples/*/*.{ts,tsx}", {
	query: "?raw",
	import: "default",
	eager: true,
});

export interface ExampleEntry {
	/** "basic/UnitCircle" */
	name: string;
	category: string;
	id: string;
	meta: ExampleMeta;
	/** The file's source with the `export const meta = {...};` block removed. */
	source: string;
	/** "tsx" for a Solid example, "ts" for a framework-free one. */
	lang: "ts" | "tsx";
}

const META_BLOCK = /^export const meta = (\{[\s\S]*?^\});\n(\n)?/m;

/**
 * Reads an example's `meta` out of its source text. The example modules are
 * deliberately not imported at build time: that would evaluate the whole
 * library in Astro's server environment just to read three fields.
 */
export function parseMeta(source: string): unknown {
	const block = META_BLOCK.exec(source)?.[1];
	// The block is a plain object literal in a file this repo owns.
	return block ? new Function(`return (${block});`)() : undefined;
}

/** Removes the `export const meta = {...};` block (and one trailing blank line). */
export function stripMeta(source: string): string {
	return source.replace(META_BLOCK, "");
}

function entryFor(key: string): ExampleEntry {
	const name = key.replace(/^\.\.\/examples\//, "").replace(/\.tsx?$/, "");
	const [category = "", id = ""] = name.split("/");
	const meta = parseMeta(sources[key] ?? "") as ExampleMeta | undefined;
	if (
		!meta?.title ||
		!meta.description ||
		!Array.isArray(meta.uses) ||
		meta.uses.length === 0
	) {
		throw new Error(
			`Example "${name}" must export meta = { title, description, uses: [...] } (all non-empty).`,
		);
	}
	const lang = key.endsWith(".tsx") ? "tsx" : "ts";
	return {
		name,
		category,
		id,
		meta,
		source: stripMeta(sources[key] ?? ""),
		lang,
	};
}

export function getExample(name: string): ExampleEntry {
	const entry = getAll().find((e) => e.name === name);
	if (!entry) {
		throw new Error(
			`Unknown example "${name}". Known: ${getAll()
				.map((e) => e.name)
				.join(", ")}`,
		);
	}
	return entry;
}

let all: ExampleEntry[] | undefined;
function getAll(): ExampleEntry[] {
	all ??= Object.keys(sources).sort().map(entryFor);
	return all;
}

/**
 * "Start here" ordering for the categories shown on one page: ids listed here
 * come first, in this order; any example not listed (new files) follows in
 * file-name order. Categories split into sub-pages take their order from
 * {@link SUBGALLERIES} instead.
 */
const ORDER: Record<string, readonly string[]> = {
	basic: [
		"ShapesGallery",
		"FirstSceneShapes",
		"UnitCircle",
		"GroupTransforms",
		"LabelsAndPositioning",
		"LabelledDiagram",
		"CoordinatePlane",
		"VectorArrow",
		"RectDimensions",
		"GradientsAndStrokes",
		"ThemeColors",
		"PaletteSwitcher",
		"OklchBlend",
	],
	maths: [
		"EulerIdentity",
		"QuadraticFormula",
		"FormulaMorph",
		"TaylorSeries",
		"FourierSquareWave",
		"LinearTransformation",
		"ComplexMultiplication",
	],
	"three-d": [
		"OrbitScene",
		"HelixCurve",
		"SurfacePlot3D",
		"BarChart3D",
		"StemPlot3D",
		"CameraMotion",
	],
	advanced: [
		"SineCurveUnitCircle",
		"FourierEpicycles",
		"GradientDescent",
		"SortingVisualizer",
		"ScrubbableSort",
		"GraphTraversal",
		"CustomSpiralShape",
		"ExportStill",
	],
};

/** A sub-page of a gallery category: `/gallery/<category>/<slug>/`. */
export interface SubGallery {
	slug: string;
	title: string;
	/** One line for the overview pages. */
	blurb: string;
	/** Its examples' ids, in reading order. */
	ids: readonly string[];
}

/**
 * Categories too large for one page, split into sub-pages. The examples stay
 * in `src/examples/<category>/`, so their names ("plotting/BarChartReveal"),
 * and the visual baselines filed under them, do not depend on the split. Every
 * example of a split category must be listed in exactly one sub-page; a new
 * file that is not fails the build (see {@link subGalleryOf}).
 */
export const SUBGALLERIES: Record<string, readonly SubGallery[]> = {
	animation: [
		{
			slug: "tweens-and-effects",
			title: "Tweens and effects",
			blurb:
				"Entrances, easing, writing, morphs, emphasis and motion along paths.",
			ids: [
				"FadeAndGrow",
				"FirstSceneAnimated",
				"EasingComparison",
				"RateFunctions",
				"WriteAndErase",
				"EmphasisEffects",
				"IndicationEffects",
				"AnimatedBoundaryHighlight",
				"MorphShapes",
				"MatchingShapes",
				"PointMovingOnShapes",
				"ArcsTrailsAndSpeed",
				"MovingAngle",
				"AnimatedNumbers",
			],
		},
		{
			slug: "sequencing-and-timelines",
			title: "Sequencing and timelines",
			blurb: "Composing animations, scrubbing, chapters and custom animations.",
			ids: [
				"Sequencing",
				"ScrubbableTimeline",
				"FirstSceneTimeline",
				"ScrubChapters",
				"OneTrackManyDrivers",
				"CustomAnimationLeaf",
			],
		},
	],
	plotting: [
		{
			slug: "function-graphs",
			title: "Function graphs and calculus",
			blurb:
				"Axes, function and polar graphs, areas, tangents and vector fields.",
			ids: [
				"SinAndCosFunctionPlot",
				"LogScaleAxes",
				"PolarRose",
				"AreaUnderCurve",
				"SecantToTangent",
				"VectorFieldPendulum",
			],
		},
		{
			slug: "bars-and-parts",
			title: "Bars, pies and part-to-whole",
			blurb:
				"Bar, histogram, waterfall, funnel, waffle, mosaic, pie and gauge charts.",
			ids: [
				"BarChartReveal",
				"HorizontalBars",
				"GroupedAndStackedBars",
				"StackedBarLabels",
				"DivergingBars",
				"HistogramBins",
				"WaterfallSteps",
				"BulletChart",
				"FunnelStages",
				"Waffle",
				"MosaicShares",
				"PieAndRadar",
				"Gauge",
			],
		},
		{
			slug: "lines-and-areas",
			title: "Lines, areas and time series",
			blurb:
				"Line and area charts, time axes, stacks, streamgraphs and candlesticks.",
			ids: [
				"ChartAutoFit",
				"LineCurves",
				"SeriesLegend",
				"TimeSeries",
				"AnnotatedSeries",
				"SweepReveal",
				"DualAxis",
				"StackedAreas",
				"Streamgraph",
				"CandlestickPrices",
			],
		},
		{
			slug: "scatter-and-distributions",
			title: "Scatter and distributions",
			blurb:
				"Scatter plots, fits, strip and swarm plots, boxes, violins and densities.",
			ids: [
				"ScatterWithErrorBars",
				"RegressionBand",
				"RobustLoess",
				"StripAndSwarm",
				"BoxAndViolin",
				"GroupedBoxes",
				"DensityAndRug",
				"Ridgeline",
				"ParallelCoordinates",
			],
		},
		{
			slug: "facets-and-linked-views",
			title: "Facets and linked views",
			blurb:
				"Small multiples, pair and joint plots, and brushes that drive other charts.",
			ids: [
				"FacetGrid",
				"FacetRowCol",
				"FacetGridScales",
				"FacetFreeSpace",
				"PairPlotMatrix",
				"JointDensity",
				"LinkedBrush",
				"BoxBrush",
				"CategoryBrush",
			],
		},
		{
			slug: "heatmaps-and-contours",
			title: "Heatmaps and contours",
			blurb:
				"Gridded and scattered fields as colour, iso-lines and colour norms.",
			ids: [
				"HeatmapAnnotated",
				"HeatmapContours",
				"ClusteredHeatmap",
				"ColorNorms",
				"TriangulatedField",
			],
		},
		{
			slug: "hierarchies-and-networks",
			title: "Hierarchies, networks and flows",
			blurb:
				"Treemaps, sunbursts, trees, network layouts, Sankey and chord diagrams.",
			ids: [
				"Treemap",
				"Sunburst",
				"TreeDendrogram",
				"RadialTree",
				"TreemapTransition",
				"TreemapResquarify",
				"SunburstDrillDown",
				"TreeTransition",
				"NetworkLayouts",
				"Sankey",
				"ChordDiagram",
				"DirectedChord",
			],
		},
		{
			slug: "chart-transitions",
			title: "Chart transitions",
			blurb:
				"Data that morphs, keyed updates, rescaling axes, sorting, races and streams.",
			ids: [
				"BarChartMorph",
				"LineMorph",
				"StackMorph",
				"BarsToScatter",
				"AxisRescale",
				"KeyedScatter",
				"KeyedBubbles",
				"KeyedBeeswarm",
				"KeyedBoxes",
				"KeyedPie",
				"RadarAxes",
				"SortedBars",
				"BarChartRace",
				"AnimatedScatterTrails",
				"StreamingSeries",
			],
		},
	],
	interaction: [
		{
			slug: "dragging-and-input",
			title: "Dragging and input",
			blurb:
				"Draggables, constraints, keyboard access, sliders, drop targets and scroll.",
			ids: [
				"FirstSceneDraggable",
				"DragConstraints",
				"RingDrag",
				"KeyboardAccessible",
				"ParameterSlider",
				"LinkedDots",
				"DropTargets",
				"StepThroughLesson",
				"ScrollDrivenStage",
			],
		},
		{
			slug: "cameras-and-zoom",
			title: "Cameras, zoom and drill-down",
			blurb:
				"Pan and zoom, camera flights, inset views, chart zoom and hierarchy drill-down.",
			ids: [
				"PanZoomPlane",
				"CameraFlight",
				"PictureInPictureViews",
				"ChartZoomPan",
				"BoxZoom",
				"CategoryZoom",
				"TreemapDrillDown",
				"TreeDrillDown",
				"ZoomableCirclePack",
			],
		},
	],
};

/** The sub-pages of a category; empty for a category shown on one page. */
export function subGalleries(category: string): readonly SubGallery[] {
	return SUBGALLERIES[category] ?? [];
}

/**
 * The sub-page an example is listed on, or undefined for a category shown on
 * one page. Throws for an example of a split category that no sub-page lists.
 */
export function subGalleryOf(entry: ExampleEntry): SubGallery | undefined {
	const pages = SUBGALLERIES[entry.category];
	if (!pages) return undefined;
	const page = pages.find((p) => p.ids.includes(entry.id));
	if (!page) {
		throw new Error(
			`Example "${entry.name}" is on no gallery page: add "${entry.id}" to one of SUBGALLERIES.${entry.category} in src/lib/examples.ts.`,
		);
	}
	return page;
}

/** The URL of an example on its gallery page, with its anchor. */
export function galleryHref(entry: ExampleEntry): string {
	const page = subGalleryOf(entry);
	return `/gallery/${entry.category}/${page ? `${page.slug}/` : ""}#${entry.id}`;
}

/**
 * Examples of one category, or of one of its sub-pages: the sub-page's order,
 * or for a category on one page the "start here" order, then the rest by file
 * name.
 */
export function examplesIn(category: string, sub?: string): ExampleEntry[] {
	const inCategory = getAll().filter((e) => e.category === category);
	const pages = SUBGALLERIES[category];
	if (pages) {
		// Every example must be on a page, and every listed id must exist.
		for (const e of inCategory) subGalleryOf(e);
		const known = new Set(inCategory.map((e) => e.id));
		for (const page of pages)
			for (const id of page.ids)
				if (!known.has(id))
					throw new Error(
						`SUBGALLERIES.${category}/${page.slug} lists "${id}", which is not an example in src/examples/${category}/.`,
					);
		const selected =
			sub === undefined ? pages : pages.filter((p) => p.slug === sub);
		if (selected.length === 0)
			throw new Error(`Unknown gallery page "${category}/${sub}".`);
		const byId = new Map(inCategory.map((e) => [e.id, e]));
		return selected.flatMap((p) =>
			p.ids.map((id) => byId.get(id) as ExampleEntry),
		);
	}
	if (sub !== undefined)
		throw new Error(`Gallery category "${category}" has no sub-pages.`);
	const order = ORDER[category] ?? [];
	const rank = (e: ExampleEntry) => {
		const i = order.indexOf(e.id);
		return i === -1 ? order.length : i;
	};
	// Array#sort is stable, so unlisted examples keep file-name order.
	return inCategory.sort((a, b) => rank(a) - rank(b));
}
