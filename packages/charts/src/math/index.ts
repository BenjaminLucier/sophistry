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

export type { BarSlotBox3D } from "./3d/bar3d";
export { bar3dSlots } from "./3d/bar3d";
export type { QuiverOptions, QuiverVector3 } from "./3d/quiver3d";
export { quiverVectors } from "./3d/quiver3d";
export type { ScatterPoint3 } from "./3d/scatter3d";
export { scatterPoints3 } from "./3d/scatter3d";
export type { Stem3DOptions, StemPoint3 } from "./3d/stem3d";
export { stemPoints3 } from "./3d/stem3d";
export type { SurfaceGrid, SurfaceGridFace } from "./3d/surfaceGrid3d";
export { surfaceGridFaces, surfaceGridWireframe } from "./3d/surfaceGrid3d";
export { trisurfaceFaces } from "./3d/trisurface";
export type { VoxelFace } from "./3d/voxels";
export { voxelFaces } from "./3d/voxels";
export type {
	NormalizeBasis,
	Reducer,
	ReducerName,
	RollingOptions,
} from "./aggregate";
export { normalizeValues, reduceValues, rollingValues } from "./aggregate";
export type { BarSlotBox } from "./bar";
export { barSlot, DEFAULT_BAR_WIDTH } from "./bar";
export type { BarbGlyph, BarbGlyphOptions } from "./barbs";
export { barbGlyph } from "./barbs";
export type { BarLabelSize, StackTotal } from "./barLabels";
export {
	barLabelValues,
	decimalsOf,
	INSIDE_LABEL_FADE,
	insideLabelFit,
	mixBarLabelValues,
	stackTotals,
} from "./barLabels";
export type { BoxplotOptions, BoxplotStats } from "./boxplot";
export { boxplotStats, DEFAULT_WHISKER_SCALE } from "./boxplot";
export type {
	BreadcrumbBack,
	BreadcrumbItem,
	BreadcrumbLayoutOptions,
	HierarchyPathSpec,
	WeightedPath,
} from "./breadcrumbs";
export {
	breadcrumbLayout,
	flattenPathSpec,
	isPathTransition,
	samePath,
} from "./breadcrumbs";
export type { BubbleRadii, BubbleRadiusOptions } from "./bubble";
export { bubbleLegendValues, bubbleRadiusScale } from "./bubble";
export type {
	BulletBand,
	BulletDomainOptions,
	BulletRowGeometry,
	BulletRowOptions,
	BulletSpan,
} from "./bullet";
export { bulletDomain, bulletRow } from "./bullet";
export type {
	ChordEnd,
	ChordGroup,
	ChordLayout,
	ChordLink,
	ChordOptions,
	ChordRibbonOptions,
} from "./chord";
export { chordLayout, chordRibbon } from "./chord";
export type {
	ClusterLinkage,
	ClusterMetric,
	ClusterNode,
	ClusterOptions,
	ClusterTree,
} from "./cluster";
export { clusterRows, distanceMatrix, leafOrder, linkageTree } from "./cluster";
export type { ContourLine } from "./contour";
export { contourLines } from "./contour";
export type { ContourBand } from "./contourf";
export { contourBands } from "./contourf";
export type { BeeswarmOptions } from "./dodge";
export { beeswarmOffsets, dodgeSpan } from "./dodge";
export type { EcdfOptions, EcdfSteps } from "./ecdf";
export {
	DEFAULT_ECDF_PAD_FALLBACK,
	DEFAULT_ECDF_PAD_FRACTION,
	ecdfSteps,
} from "./ecdf";
export type { ErrorBarPoint, ErrorSpec } from "./errorbar";
export { errorBarPoints } from "./errorbar";
export type { EventPlotOptions, EventRow } from "./eventplot";
export { eventPlotRows } from "./eventplot";
export type {
	FacetCell,
	FacetGrid,
	FacetGridOptions,
	FacetSlot,
	FacetSlots,
	SideRoom,
} from "./facet";
export { facetGrid, facetSlots, outerEdge, panelProgress } from "./facet";
export type { FillBetweenRings } from "./fillBetween";
export { fillBetweenCurve, fillBetweenRings } from "./fillBetween";
export type { GaugeBandSpan } from "./gauge";
export {
	GAUGE_END_ANGLE,
	GAUGE_START_ANGLE,
	gaugeAngle,
	gaugeBandIndex,
	gaugeBands,
	gaugeFraction,
} from "./gauge";
export type { HexBinCell } from "./hexbin";
export { hexbin } from "./hexbin";
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
} from "./hierarchy";
export {
	packLayout,
	partitionLayout,
	treemapLayout,
	treemapRows,
} from "./hierarchy";
export type { HierarchyJoinInfo, HierarchyJoinOptions } from "./hierarchyJoin";
export { hierarchyJoin, hierarchyKeys } from "./hierarchyJoin";
export type { HistogramBins, HistogramOptions } from "./histogram";
export { DEFAULT_BIN_COUNT, histogramBins } from "./histogram";
export type { Histogram2D, Histogram2DOptions } from "./histogram2d";
export { histogram2d } from "./histogram2d";
export type { ImshowCell, ImshowOptions, ImshowResult } from "./imshow";
export { imshowCells } from "./imshow";
export type { JitterOptions } from "./jitter";
export { jitterOffsets } from "./jitter";
export type {
	JoinStageOptions,
	JoinStages,
	JoinStaging,
	KeyedJoin,
	StageWindow,
} from "./join";
export {
	joinStages,
	keyedJoin,
	keyWindow,
	rescaleKind,
	rescaleWindow,
	stageProgress,
	staggeredStageProgress,
} from "./join";
export type {
	KeyframeSpan,
	RaceEntry,
	RaceOptions,
	RaceTimeline,
	RaceView,
} from "./keyframes";
export { keyframeAt, raceTimeline, trailPolyline } from "./keyframes";
export type {
	LegendItemLayout,
	LegendLayout,
	LegendLayoutOptions,
	SizeLegendItemLayout,
	SizeLegendLayout,
	SizeLegendLayoutOptions,
} from "./legend";
export { legendLayout, sizeLegendLayout } from "./legend";
export {
	DECIMATION_MIN_PER_COLUMN,
	dataRuns,
	decimateRun,
	isNonDecreasingX,
	sameRuns,
} from "./line";
export type { AreaPoint, StepFunction } from "./morph";
export {
	morphArea,
	morphAreaRuns,
	morphPolyline,
	morphRuns,
	morphSteps,
} from "./morph";
export type {
	MosaicColumn,
	MosaicInput,
	MosaicKey,
	MosaicLayout,
	MosaicOptions,
	MosaicRect,
} from "./mosaic";
export { mosaicLayout } from "./mosaic";
export type { OrdinalColorScale, OrdinalColorScaleOptions } from "./ordinal";
export {
	datumKeys,
	observable10,
	okabeIto,
	ordinalColorScale,
	tableau10,
	uniqueKeys,
} from "./ordinal";
export type { ParallelLine } from "./parallel";
export { parallelAxisX, parallelLines } from "./parallel";
export type { PcolormeshCell, PcolormeshResult } from "./pcolormesh";
export { pcolormeshCells } from "./pcolormesh";
export type { PieOptions, PieSlice, RingSlice, SweepWedgeOptions } from "./pie";
export {
	pieGrow,
	pieSlices,
	pieSweep,
	ringLayout,
	ringOrder,
	sweepShare,
	sweepWedge,
} from "./pie";
export type { PolarAreaOptions, PolarAreaSlice } from "./polarArea";
export { polarAreaSlices } from "./polarArea";
export type {
	RadarAxisFrame,
	RadarAxisFrameOptions,
	RadarOptions,
	RadarVertex,
} from "./radar";
export {
	assertRadarShape,
	radarAxisFrames,
	radarFramePolygon,
	radarLabelOffset,
	radarVertices,
} from "./radar";
export type {
	AlignedRangeOptions,
	AutoRangeOptions,
	FitRangeOptions,
} from "./range";
export { alignedRange, autoRange, fitRange } from "./range";
export type {
	LoessBandOptions,
	LoessOptions,
	MeanInterval,
	RegressionOptions,
	RegressionPoint,
} from "./regression";
export {
	loess,
	loessBand,
	meanInterval,
	regression,
	studentT,
} from "./regression";
export {
	clipPolylineToX,
	clipRingToX,
	revealClipAlongX,
	revealCutoff,
	revealPolylinesAlongX,
	revealRingsAlongX,
	xExtent,
} from "./reveal";
export type {
	SankeyAlign,
	SankeyId,
	SankeyLayout,
	SankeyLink,
	SankeyLinkInput,
	SankeyNode,
	SankeyOptions,
	SankeyRibbonOptions,
} from "./sankey";
export { sankeyLayout, sankeyRibbon } from "./sankey";
export type { ScatterPoint } from "./scatter";
export { scatterPoints } from "./scatter";
export { binIndex } from "./shared/binning";
export type { GridCell, GridResult } from "./shared/gridCells";
export { gridNcols } from "./shared/gridCells";
export { dataExtent } from "./shared/gridExtent";
export type { PolarSweepOptions } from "./shared/polar";
export { resolvePolarSweep } from "./shared/polar";
export type {
	StackColumnsOptions,
	StackColumnsResult,
	StackItem,
	StackOffset,
	StackOrder,
} from "./stack";
export { stackColumns, stackOrder } from "./stack";
export type { StackedBand, StackPlotOptions } from "./stackplot";
export { stackedBands } from "./stackplot";
export type { StairsPolyline } from "./stairs";
export { stairsPolyline } from "./stairs";
export type { StemOptions, StemPoint } from "./stem";
export { stemPoints } from "./stem";
export type { SymbolName } from "./symbol";
export { SYMBOLS, symbolPolygon } from "./symbol";
export type {
	RadialTreeLinkOptions,
	TreeLayoutKind,
	TreeLayoutOptions,
	TreeLinkOptions,
	TreeLinkShape,
	TreeNode,
} from "./tree";
export {
	hierarchyTreeLayout,
	radialTreeLink,
	radialTreePoint,
	treeLink,
} from "./tree";
export type {
	TriangleIndices,
	TriangulationOptions,
	TripcolorFace,
} from "./tricontour";
export {
	triangulate,
	tricontourBands,
	tricontourLines,
	tripcolorFaces,
} from "./tricontour";
export type {
	GaussianKdeOptions,
	KdePoint,
	ViolinProfile,
	ViolinRingOptions,
} from "./violin";
export {
	blendViolinProfiles,
	DEFAULT_SAMPLES,
	DEFAULT_VIOLIN_SCALE,
	gaussianKde,
	violinProfile,
	violinProfileRing,
	violinRing,
} from "./violin";
export type { WaffleCell, WaffleOptions } from "./waffle";
export { largestRemainder, waffleCells } from "./waffle";
export type { WaterfallStep } from "./waterfall";
export { waterfallSteps } from "./waterfall";
