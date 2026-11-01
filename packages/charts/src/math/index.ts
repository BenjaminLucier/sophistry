/**
 * `@sophistry/charts/math`: the pure data-to-geometry functions behind the
 * charts (bins, stacks, layouts, contours, keyed joins, 3D chart faces). Plain
 * functions of plain data, in scene units with y up; call them directly for
 * geometry without a scene.
 *
 * @example
 * ```ts
 * import { histogramBins, stackColumns } from "@sophistry/charts/math";
 *
 * const bins = histogramBins([1, 2, 2, 3, 5, 8], { binCount: 4 });
 * ```
 *
 * @module @sophistry/charts/math
 * @packageDocumentation
 */

export type { BarSlotBox3D } from "./3d/bar3d.js";
export { bar3dSlots } from "./3d/bar3d.js";
export type { QuiverOptions, QuiverVector3 } from "./3d/quiver3d.js";
export { quiverVectors } from "./3d/quiver3d.js";
export type { ScatterPoint3 } from "./3d/scatter3d.js";
export { scatterPoints3 } from "./3d/scatter3d.js";
export type { Stem3DOptions, StemPoint3 } from "./3d/stem3d.js";
export { stemPoints3 } from "./3d/stem3d.js";
export type { SurfaceGrid, SurfaceGridFace } from "./3d/surfaceGrid3d.js";
export { surfaceGridFaces, surfaceGridWireframe } from "./3d/surfaceGrid3d.js";
export { trisurfaceFaces } from "./3d/trisurface.js";
export type { VoxelFace } from "./3d/voxels.js";
export { voxelFaces } from "./3d/voxels.js";
export type {
	NormalizeBasis,
	Reducer,
	ReducerName,
	RollingOptions,
} from "./aggregate.js";
export { normalizeValues, reduceValues, rollingValues } from "./aggregate.js";
export type { BarSlotBox } from "./bar.js";
export { barSlot, DEFAULT_BAR_WIDTH } from "./bar.js";
export type { BarbGlyph, BarbGlyphOptions } from "./barbs.js";
export { barbGlyph } from "./barbs.js";
export type { BarLabelSize, StackTotal } from "./barLabels.js";
export {
	barLabelValues,
	decimalsOf,
	INSIDE_LABEL_FADE,
	insideLabelFit,
	mixBarLabelValues,
	stackTotals,
} from "./barLabels.js";
export type { BoxplotOptions, BoxplotStats } from "./boxplot.js";
export { boxplotStats, DEFAULT_WHISKER_SCALE } from "./boxplot.js";
export type {
	BreadcrumbBack,
	BreadcrumbItem,
	BreadcrumbLayoutOptions,
	HierarchyPathSpec,
	WeightedPath,
} from "./breadcrumbs.js";
export {
	breadcrumbLayout,
	flattenPathSpec,
	isPathTransition,
	samePath,
} from "./breadcrumbs.js";
export type { BubbleRadii, BubbleRadiusOptions } from "./bubble.js";
export { bubbleLegendValues, bubbleRadiusScale } from "./bubble.js";
export type {
	BulletBand,
	BulletDomainOptions,
	BulletRowGeometry,
	BulletRowOptions,
	BulletSpan,
} from "./bullet.js";
export { bulletDomain, bulletRow } from "./bullet.js";
export type {
	ChordEnd,
	ChordGroup,
	ChordLayout,
	ChordLink,
	ChordOptions,
	ChordRibbonOptions,
} from "./chord.js";
export { chordLayout, chordRibbon } from "./chord.js";
export type {
	ClusterLinkage,
	ClusterMetric,
	ClusterNode,
	ClusterOptions,
	ClusterTree,
} from "./cluster.js";
export {
	clusterRows,
	distanceMatrix,
	leafOrder,
	linkageTree,
} from "./cluster.js";
export type { ContourLine } from "./contour.js";
export { contourLines } from "./contour.js";
export type { ContourBand } from "./contourf.js";
export { contourBands } from "./contourf.js";
export type { BeeswarmOptions } from "./dodge.js";
export { beeswarmOffsets, dodgeSpan } from "./dodge.js";
export type { EcdfOptions, EcdfSteps } from "./ecdf.js";
export {
	DEFAULT_ECDF_PAD_FALLBACK,
	DEFAULT_ECDF_PAD_FRACTION,
	ecdfSteps,
} from "./ecdf.js";
export type { ErrorBarPoint, ErrorSpec } from "./errorbar.js";
export { errorBarPoints } from "./errorbar.js";
export type { EventPlotOptions, EventRow } from "./eventplot.js";
export { eventPlotRows } from "./eventplot.js";
export type {
	FacetCell,
	FacetGrid,
	FacetGridOptions,
	FacetSlot,
	FacetSlots,
	SideRoom,
} from "./facet.js";
export { facetGrid, facetSlots, outerEdge, panelProgress } from "./facet.js";
export type { FillBetweenRings } from "./fillBetween.js";
export { fillBetweenCurve, fillBetweenRings } from "./fillBetween.js";
export type { GaugeBandSpan } from "./gauge.js";
export {
	GAUGE_END_ANGLE,
	GAUGE_START_ANGLE,
	gaugeAngle,
	gaugeBandIndex,
	gaugeBands,
	gaugeFraction,
} from "./gauge.js";
export type { HexBinCell } from "./hexbin.js";
export { hexbin } from "./hexbin.js";
export type {
	HierarchyCircle,
	HierarchyNodeInfo,
	HierarchyOptions,
	HierarchyRect,
	PackOptions,
	PartitionOptions,
	TreemapOptions,
	TreemapRow,
	TreemapRows,
	TreemapTile,
} from "./hierarchy.js";
export {
	packLayout,
	partitionLayout,
	treemapLayout,
	treemapRows,
} from "./hierarchy.js";
export type {
	HierarchyJoinInfo,
	HierarchyJoinOptions,
} from "./hierarchyJoin.js";
export { hierarchyJoin, hierarchyKeys } from "./hierarchyJoin.js";
export type { HistogramBins, HistogramOptions } from "./histogram.js";
export { DEFAULT_BIN_COUNT, histogramBins } from "./histogram.js";
export type { Histogram2D, Histogram2DOptions } from "./histogram2d.js";
export { histogram2d } from "./histogram2d.js";
export type { ImshowCell, ImshowOptions, ImshowResult } from "./imshow.js";
export { imshowCells } from "./imshow.js";
export type { JitterOptions } from "./jitter.js";
export { jitterOffsets } from "./jitter.js";
export type {
	JoinStageOptions,
	JoinStages,
	JoinStaging,
	KeyedJoin,
	StageWindow,
} from "./join.js";
export {
	joinStages,
	keyedJoin,
	keyWindow,
	rescaleKind,
	rescaleWindow,
	stageProgress,
	staggeredStageProgress,
} from "./join.js";
export type {
	KeyframeSpan,
	RaceEntry,
	RaceOptions,
	RaceTimeline,
	RaceView,
} from "./keyframes.js";
export { keyframeAt, raceTimeline, trailPolyline } from "./keyframes.js";
export type {
	LegendItemLayout,
	LegendLayout,
	LegendLayoutOptions,
	SizeLegendItemLayout,
	SizeLegendLayout,
	SizeLegendLayoutOptions,
} from "./legend.js";
export { legendLayout, sizeLegendLayout } from "./legend.js";
export {
	DECIMATION_MIN_PER_COLUMN,
	dataRuns,
	decimateRun,
	isNonDecreasingX,
	sameRuns,
} from "./line.js";
export type { AreaPoint, StepFunction } from "./morph.js";
export {
	morphArea,
	morphAreaRuns,
	morphPolyline,
	morphRuns,
	morphSteps,
} from "./morph.js";
export type {
	MosaicColumn,
	MosaicInput,
	MosaicKey,
	MosaicLayout,
	MosaicOptions,
	MosaicRect,
} from "./mosaic.js";
export { mosaicLayout } from "./mosaic.js";
export type { OrdinalColorScale, OrdinalColorScaleOptions } from "./ordinal.js";
export {
	datumKeys,
	observable10,
	okabeIto,
	ordinalColorScale,
	tableau10,
	uniqueKeys,
} from "./ordinal.js";
export type { ParallelLine } from "./parallel.js";
export { parallelAxisX, parallelLines } from "./parallel.js";
export type { PcolormeshCell, PcolormeshResult } from "./pcolormesh.js";
export { pcolormeshCells } from "./pcolormesh.js";
export type {
	PieOptions,
	PieSlice,
	RingSlice,
	SweepWedgeOptions,
} from "./pie.js";
export {
	pieGrow,
	pieSlices,
	pieSweep,
	ringLayout,
	ringOrder,
	sweepShare,
	sweepWedge,
} from "./pie.js";
export type { PolarAreaOptions, PolarAreaSlice } from "./polarArea.js";
export { polarAreaSlices } from "./polarArea.js";
export type {
	RadarAxisFrame,
	RadarAxisFrameOptions,
	RadarOptions,
	RadarVertex,
} from "./radar.js";
export {
	assertRadarShape,
	radarAxisFrames,
	radarFramePolygon,
	radarLabelOffset,
	radarVertices,
} from "./radar.js";
export type {
	AlignedRangeOptions,
	AutoRangeOptions,
	FitRangeOptions,
} from "./range.js";
export { alignedRange, autoRange, fitRange } from "./range.js";
export type {
	LoessBandOptions,
	LoessOptions,
	MeanInterval,
	RegressionOptions,
	RegressionPoint,
} from "./regression.js";
export {
	loess,
	loessBand,
	meanInterval,
	regression,
	studentT,
} from "./regression.js";
export {
	clipPolylineToX,
	clipRingToX,
	revealClipAlongX,
	revealCutoff,
	revealPolylinesAlongX,
	revealRingsAlongX,
	xExtent,
} from "./reveal.js";
export type {
	SankeyAlign,
	SankeyId,
	SankeyLayout,
	SankeyLink,
	SankeyLinkInput,
	SankeyNode,
	SankeyOptions,
	SankeyRibbonOptions,
} from "./sankey.js";
export { sankeyLayout, sankeyRibbon } from "./sankey.js";
export type { ScatterPoint } from "./scatter.js";
export { scatterPoints } from "./scatter.js";
export { binIndex } from "./shared/binning.js";
export type { GridCell, GridResult } from "./shared/gridCells.js";
export { gridNcols } from "./shared/gridCells.js";
export { dataExtent } from "./shared/gridExtent.js";
export type { PolarSweepOptions } from "./shared/polar.js";
export { resolvePolarSweep } from "./shared/polar.js";
export type {
	StackColumnsOptions,
	StackColumnsResult,
	StackItem,
	StackOffset,
	StackOrder,
} from "./stack.js";
export { stackColumns, stackOrder } from "./stack.js";
export type { StackedBand, StackPlotOptions } from "./stackplot.js";
export { stackedBands } from "./stackplot.js";
export type { StairsPolyline } from "./stairs.js";
export { stairsPolyline } from "./stairs.js";
export type { StemOptions, StemPoint } from "./stem.js";
export { stemPoints } from "./stem.js";
export type { SymbolName } from "./symbol.js";
export { SYMBOLS, symbolPolygon } from "./symbol.js";
export type {
	RadialTreeLinkOptions,
	TreeLayoutKind,
	TreeLayoutOptions,
	TreeLinkOptions,
	TreeLinkShape,
	TreeNode,
} from "./tree.js";
export {
	hierarchyTreeLayout,
	radialTreeLink,
	radialTreePoint,
	treeLink,
} from "./tree.js";
export type {
	TriangleIndices,
	TriangulationOptions,
	TripcolorFace,
} from "./tricontour.js";
export {
	triangulate,
	tricontourBands,
	tricontourLines,
	tripcolorFaces,
} from "./tricontour.js";
export type {
	GaussianKdeOptions,
	KdePoint,
	ViolinProfile,
	ViolinRingOptions,
} from "./violin.js";
export {
	blendViolinProfiles,
	DEFAULT_SAMPLES,
	DEFAULT_VIOLIN_SCALE,
	gaussianKde,
	violinProfile,
	violinProfileRing,
	violinRing,
} from "./violin.js";
export type { WaffleCell, WaffleOptions } from "./waffle.js";
export { largestRemainder, waffleCells } from "./waffle.js";
export type { WaterfallStep } from "./waterfall.js";
export { waterfallSteps } from "./waterfall.js";
