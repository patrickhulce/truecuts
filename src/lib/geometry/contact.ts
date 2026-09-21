import { applyPose } from "./pose";
import { convexArea, intersectConvex } from "./polygon";
import { faceNormal } from "./solids";
import type { Face, Polyhedron, Vec3 } from "./types";
import { add, dot, scale } from "./vec3";

export type FaceRef = { instanceKey: string; faceIndex: number };

export type SharedPatch = {
  key: string;
  a: FaceRef;
  b: FaceRef;
  polygon: Face;
  area: number;
  normal: Vec3;
};

export type HostFace = {
  instanceKey: string;
  faceIndex: number;
  polygon: Face;
  normal: Vec3;
  patchKeys: string[];
};

export type SceneContacts = {
  hosts: HostFace[];
  patches: SharedPatch[];
};

export type PosedSolid = {
  key: string;
  faces: Polyhedron;
  position: Vec3;
  rotation: Vec3;
  componentPosition: Vec3;
  componentRotation: Vec3;
  bounds: { min: Vec3; max: Vec3 };
};

export const CONTACT_GAP = 1e-3;
const OPPOSITE_DOT = -0.99;

const ZERO: Vec3 = [0, 0, 0];

export function worldPolyhedron(
  faces: Polyhedron,
  position: Vec3,
  rotation: Vec3,
  componentPosition: Vec3 = ZERO,
  componentRotation: Vec3 = ZERO,
): Polyhedron {
  return faces.map((face) =>
    face.map((point) => applyPose(applyPose(point, position, rotation), componentPosition, componentRotation)),
  );
}

function worldAabb(
  bounds: { min: Vec3; max: Vec3 },
  position: Vec3,
  rotation: Vec3,
  componentPosition: Vec3,
  componentRotation: Vec3,
): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const p = applyPose(
          applyPose([x, y, z], position, rotation),
          componentPosition,
          componentRotation,
        );
        min[0] = Math.min(min[0], p[0]);
        min[1] = Math.min(min[1], p[1]);
        min[2] = Math.min(min[2], p[2]);
        max[0] = Math.max(max[0], p[0]);
        max[1] = Math.max(max[1], p[1]);
        max[2] = Math.max(max[2], p[2]);
      }
    }
  }
  return { min, max };
}

function aabbOverlap(a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }, gap: number): boolean {
  return (
    a.max[0] >= b.min[0] - gap &&
    b.max[0] >= a.min[0] - gap &&
    a.max[1] >= b.min[1] - gap &&
    b.max[1] >= a.min[1] - gap &&
    a.max[2] >= b.min[2] - gap &&
    b.max[2] >= a.min[2] - gap
  );
}

function patchKey(a: FaceRef, b: FaceRef): string {
  const left = `${a.instanceKey}#${a.faceIndex}`;
  const right = `${b.instanceKey}#${b.faceIndex}`;
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function hostId(instanceKey: string, faceIndex: number): string {
  return `${instanceKey}#${faceIndex}`;
}

export function findContacts(solids: PosedSolid[], gap = CONTACT_GAP): SceneContacts {
  const worldFaces = solids.map((solid) =>
    worldPolyhedron(solid.faces, solid.position, solid.rotation, solid.componentPosition, solid.componentRotation),
  );
  const aabbs = solids.map((solid) =>
    worldAabb(solid.bounds, solid.position, solid.rotation, solid.componentPosition, solid.componentRotation),
  );

  const patches: SharedPatch[] = [];
  const hostMap = new Map<string, HostFace>();

  const ensureHost = (solidIndex: number, faceIndex: number): HostFace => {
    const instanceKey = solids[solidIndex].key;
    const id = hostId(instanceKey, faceIndex);
    let host = hostMap.get(id);
    if (!host) {
      const polygon = worldFaces[solidIndex][faceIndex];
      host = {
        instanceKey,
        faceIndex,
        polygon,
        normal: faceNormal(polygon),
        patchKeys: [],
      };
      hostMap.set(id, host);
    }
    return host;
  };

  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      if (!aabbOverlap(aabbs[i], aabbs[j], gap)) continue;
      const facesI = worldFaces[i];
      const facesJ = worldFaces[j];
      for (let fi = 0; fi < facesI.length; fi++) {
        const faceA = facesI[fi];
        if (faceA.length < 3) continue;
        const nA = faceNormal(faceA);
        const dA = dot(nA, faceA[0]);
        for (let fj = 0; fj < facesJ.length; fj++) {
          const faceB = facesJ[fj];
          if (faceB.length < 3) continue;
          const nB = faceNormal(faceB);
          if (dot(nA, nB) > OPPOSITE_DOT) continue;
          const dB = dot(nA, faceB[0]);
          if (Math.abs(dA - dB) > gap) continue;
          const polygon = intersectConvex(faceA, faceB, nA);
          if (!polygon) continue;
          const area = convexArea(polygon, nA);
          if (area < 1e-6) continue;
          const a: FaceRef = { instanceKey: solids[i].key, faceIndex: fi };
          const b: FaceRef = { instanceKey: solids[j].key, faceIndex: fj };
          const key = patchKey(a, b);
          patches.push({ key, a, b, polygon, area, normal: nA });
          ensureHost(i, fi).patchKeys.push(key);
          ensureHost(j, fj).patchKeys.push(key);
        }
      }
    }
  }

  return { hosts: [...hostMap.values()], patches };
}

export function patchesFor(contacts: SceneContacts, instanceKey: string): SharedPatch[] {
  return contacts.patches.filter((patch) => patch.a.instanceKey === instanceKey || patch.b.instanceKey === instanceKey);
}

export function patchNeighbor(patch: SharedPatch, instanceKey: string): FaceRef {
  return patch.a.instanceKey === instanceKey ? patch.b : patch.a;
}

export function hostForPatch(contacts: SceneContacts, patch: SharedPatch, instanceKey: string): HostFace | undefined {
  const faceIndex = patch.a.instanceKey === instanceKey ? patch.a.faceIndex : patch.b.instanceKey === instanceKey ? patch.b.faceIndex : -1;
  if (faceIndex < 0) return undefined;
  return contacts.hosts.find((host) => host.instanceKey === instanceKey && host.faceIndex === faceIndex);
}

/** Outward unit normal of a patch on a given instance. */
export function patchNormalFor(patch: SharedPatch, instanceKey: string): Vec3 {
  if (patch.a.instanceKey === instanceKey) return patch.normal;
  return scale(patch.normal, -1);
}

export function offsetFace(face: Face, normal: Vec3, distance: number): Face {
  const delta = scale(normal, distance);
  return face.map((point) => add(point, delta));
}
