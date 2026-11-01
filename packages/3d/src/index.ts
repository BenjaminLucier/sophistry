/**
 * `@sophistry/3d`: a perspective `camera3D`, flat-shaded meshes,
 * depth-sorted projection into the same 2D specs every other shape emits,
 * and the 3D primitives built on them. The renderer never learns 3D exists.
 *
 * @module @sophistry/3d
 * @packageDocumentation
 */

export { boxFaces } from "./box.js";
export type { Camera3DProps } from "./camera3d.js";
export { Camera3DNode, camera3D } from "./camera3d.js";
export type { Camera3DValue } from "./context.js";
export { camera3DContext, requireCamera3D } from "./context.js";
export type { DepthItem, DepthSorter, DepthSource } from "./depth-sort.js";
export { MAX_DEPTH_PAIRS, sortByDepth } from "./depth-sort.js";
export type {
	Mesh3DOptions,
	Mesh3DProps,
	MeshFacesProps,
	PreparedFace,
} from "./mesh.js";
export {
	defineMesh3D,
	mesh3DProps,
	meshFaces,
	prepareFaces,
	projectFaces,
} from "./mesh.js";
export type { MeshFace, MeshLight } from "./mesh-math.js";
export {
	cross3,
	dot3,
	isFrontFacing,
	normalize3,
	subtract3,
} from "./mesh-math.js";
export type {
	OrbitControls3DController,
	OrbitControls3DHandlers,
	OrbitControls3DOptions,
	OrbitControls3DSceneOptions,
} from "./orbit-controls.js";
export { orbitControls3D, orbitControlsHandlers } from "./orbit-controls.js";
export type { PlatonicSolid } from "./polyhedra.js";
export {
	convexHullFaces,
	orientFaces,
	PLATONIC_SOLIDS,
	polyhedronMeshFaces,
} from "./polyhedra.js";
export type { Axes3DProps, Axis3DTickOptions } from "./primitives/axes3d.js";
export { axes3D } from "./primitives/axes3d.js";
export type { Cone3DProps } from "./primitives/cone3d.js";
export { cone3D } from "./primitives/cone3d.js";
export type { Curve3DProps } from "./primitives/curve3d.js";
export { curve3D } from "./primitives/curve3d.js";
export type { Cylinder3DProps } from "./primitives/cylinder3d.js";
export { cylinder3D } from "./primitives/cylinder3d.js";
export type { Grid3DProps, GridLines, GridPlane } from "./primitives/grid3d.js";
export { grid3D, gridLineCount } from "./primitives/grid3d.js";
export type { Line3DProps } from "./primitives/line3d.js";
export { line3D } from "./primitives/line3d.js";
export type {
	ConvexHull3DProps,
	PlatonicSolid3DProps,
	Polyhedron3DProps,
} from "./primitives/polyhedron3d.js";
export {
	convexHull3D,
	dodecahedron3D,
	icosahedron3D,
	octahedron3D,
	polyhedron3D,
	tetrahedron3D,
} from "./primitives/polyhedron3d.js";
export type { Cube3DProps, Prism3DProps } from "./primitives/prism3d.js";
export { cube3D, prism3D } from "./primitives/prism3d.js";
export type { Dot3DProps, Sphere3DProps } from "./primitives/sphere3d.js";
export { dot3D, sphere3D } from "./primitives/sphere3d.js";
export type { SurfacePlot3DProps } from "./primitives/surface-plot3d.js";
export { surfaceFaces, surfacePlot3D } from "./primitives/surface-plot3d.js";
export type { Torus3DProps } from "./primitives/torus3d.js";
export { torus3D } from "./primitives/torus3d.js";
export type { Vector3DProps, VectorEnds } from "./primitives/vector3d.js";
export { vector3D } from "./primitives/vector3d.js";
export type { ProjectedPoint } from "./project.js";
export { clipSegment, depthZ, projectPoint, projectScale } from "./project.js";
export type { Shape3DProps } from "./props3d.js";
export { shape3DProps } from "./props3d.js";
export type { Axis } from "./ring.js";
export { axisVector, ringPoints } from "./ring.js";
export type { ProjectedPiece, Shape3DOptions } from "./shape3d.js";
export { defineShape3D, Shape3DNode } from "./shape3d.js";
