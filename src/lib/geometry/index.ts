export type { Face, Plane, Polyhedron, Vec3 } from "./types";
export { AXIS_TO_COORD, axisCoord } from "./types";
export {
  add,
  cross,
  degToRad,
  dot,
  EPS,
  len,
  lerp,
  normalize,
  planeBasis,
  scale,
  sub,
  uniquePoints,
} from "./vec3";
export {
  boundingBox,
  boxPolyhedron,
  boxPolyhedronAt,
  faceNormal,
  flatLBracketPolyhedron,
  lBracketPolyhedron,
  polyhedronVolume,
  vertexCount,
} from "./solids";
export {
  BOX_FACE_ORDER,
  FACE_IDS,
  faceFrame,
  faceQuad,
  isFaceId,
  parseFaceId,
  placeBore,
  pointOnFace,
  type FaceFrame,
  type FaceId,
  type PlacedBore,
} from "./faces";
export { clipPolyhedron } from "./clip";
export { applyCuts, cutToPlane, defaultAround } from "./cuts";
export { gapCount, layoutClosed, layoutOpen, type Justify } from "./justify";
export { applyPose, inverseRotateEulerXYZ, rotateEulerXYZ, unapplyPose } from "./pose";
export {
  centroid3,
  convexArea,
  convexArea2D,
  fromPlane2D,
  insetConvex,
  intersectConvex,
  toPlane2D,
  type Vec2,
} from "./polygon";
export {
  CONTACT_GAP,
  findContacts,
  hostForPatch,
  offsetFace,
  patchNormalFor,
  patchesFor,
  patchNeighbor,
  worldPolyhedron,
  type FaceRef,
  type HostFace,
  type PosedSolid,
  type SceneContacts,
  type SharedPatch,
} from "./contact";
