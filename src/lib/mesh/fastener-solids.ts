import * as THREE from "three";
import {
  flatLBracketPolyhedron,
  joistHangerPolyhedron,
  lBracketPolyhedron,
  saddlePolyhedron,
  tConnectorPolyhedron,
  type Polyhedron,
  type Vec3,
} from "@/lib/geometry";
import type { SceneFastener } from "@/lib/scene";

export type CylinderPiece = {
  kind: "cylinder";
  position: Vec3;
  radiusTop: number;
  radiusBottom: number;
  height: number;
  segments: number;
};

export type FacesPiece = {
  kind: "faces";
  position: Vec3;
  faces: Polyhedron;
};

export type FastenerPiece = CylinderPiece | FacesPiece;

/** Local +Y follows `direction`. Seated hardware also sets `across` as local +X. */
export type FastenerSolid = {
  direction: Vec3;
  across?: Vec3;
  pieces: FastenerPiece[];
};

/** Glue is a contact marker, not a solid. */
export function fastenerSolid(fastener: SceneFastener): FastenerSolid | null {
  if (fastener.subtype === "glue") return null;
  if (fastener.subtype === "nail") return nailSolid(fastener);
  if (fastener.subtype === "bolt") return boltSolid(fastener);
  if (fastener.subtype === "connector") return connectorSolid(fastener);
  if (
    fastener.subtype === "bracket" ||
    fastener.subtype === "bracket-flat" ||
    fastener.subtype === "saddle" ||
    fastener.subtype === "joist-hanger"
  ) {
    return hardwareSolid(fastener);
  }
  return screwSolid(fastener);
}

/** Orient a solid so local +Y matches `direction`, and local +X matches `across` when set. */
export function fastenerQuaternion(direction: Vec3, across?: Vec3): THREE.Quaternion {
  if (!across) return lookAlongY(direction);
  return frameQuaternion(across, direction);
}

function nailSolid(fastener: SceneFastener): FastenerSolid {
  const shankR = Math.max(fastener.diameter / 2, 0.03);
  const headR = shankR * 2.4;
  const headH = Math.min(0.08, fastener.length * 0.06);
  const shankH = Math.max(fastener.length - headH, 0.05);
  return {
    direction: fastener.direction,
    pieces: [
      cylinder([0, headH / 2, 0], headR, headR, headH, 16),
      cylinder([0, headH + shankH / 2, 0], shankR, shankR, shankH, 10),
    ],
  };
}

function screwSolid(fastener: SceneFastener): FastenerSolid {
  const shankR = Math.max(fastener.diameter / 2, 0.04);
  const headR = shankR * 1.7;
  const headH = Math.min(0.12, fastener.length * 0.12);
  const shankH = Math.max(fastener.length - headH, 0.1);
  return {
    direction: fastener.direction,
    pieces: [
      cylinder([0, headH / 2, 0], headR, headR * 0.82, headH, 16),
      cylinder([0, headH + shankH / 2, 0], shankR * 0.45, shankR, shankH, 12),
    ],
  };
}

function boltSolid(fastener: SceneFastener): FastenerSolid {
  const diameter = Math.max(fastener.diameter, 0.08);
  const shankR = diameter / 2;
  const headR = (diameter * 1.5) / Math.sqrt(3);
  const headH = diameter * 0.65;
  const washerR = diameter * 1.1;
  const washerH = Math.max(diameter * 0.16, 0.04);
  const nutH = diameter * 0.8;
  const span = fastener.grip && fastener.grip > 1e-4 ? fastener.grip : fastener.length;
  const shankH = Math.max(fastener.length, 0.1);
  return {
    direction: fastener.direction,
    pieces: [
      cylinder([0, -(washerH + headH / 2), 0], headR, headR, headH, 6),
      cylinder([0, -washerH / 2, 0], washerR, washerR, washerH, 24),
      cylinder([0, shankH / 2, 0], shankR, shankR, shankH, 12),
      cylinder([0, span + washerH / 2, 0], washerR, washerR, washerH, 24),
      cylinder([0, span + washerH + nutH / 2, 0], headR, headR, nutH, 6),
    ],
  };
}

function connectorSolid(fastener: SceneFastener): FastenerSolid {
  const [length, width, thickness] = fastener.size;
  const riser = fastener.riser ?? 3;
  return {
    direction: fastener.direction,
    across: fastener.across ?? [1, 0, 0],
    pieces: [
      {
        kind: "faces",
        position: [-length / 2, -(fastener.bedInset ?? 0), -width / 2],
        faces: tConnectorPolyhedron([length, width, thickness], riser),
      },
    ],
  };
}

function hardwareSolid(fastener: SceneFastener): FastenerSolid {
  const [length, width, thickness] = fastener.size;
  const riser = fastener.riser ?? 0;
  const face = fastener.face ?? 1.5;
  const size: Vec3 = [length, width, thickness];
  const faces =
    fastener.subtype === "bracket"
      ? lBracketPolyhedron(size)
      : fastener.subtype === "bracket-flat"
        ? flatLBracketPolyhedron(size)
        : fastener.subtype === "saddle"
          ? saddlePolyhedron(size, riser)
          : joistHangerPolyhedron(size, riser, face);
  const anchor = fastener.anchor ?? [0, 0, 0];
  return {
    direction: fastener.direction,
    across: fastener.across ?? [1, 0, 0],
    pieces: [
      {
        kind: "faces",
        position: [-anchor[0], -anchor[1], -anchor[2]],
        faces,
      },
    ],
  };
}

function cylinder(
  position: Vec3,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments: number,
): CylinderPiece {
  return { kind: "cylinder", position, radiusTop, radiusBottom, height, segments };
}

function lookAlongY(direction: Vec3): THREE.Quaternion {
  const dir = new THREE.Vector3(direction[0], direction[1], direction[2]);
  if (dir.lengthSq() < 1e-10) return new THREE.Quaternion();
  dir.normalize();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}

function frameQuaternion(across: Vec3, direction: Vec3): THREE.Quaternion {
  const y = new THREE.Vector3(direction[0], direction[1], direction[2]);
  if (y.lengthSq() < 1e-10) return new THREE.Quaternion();
  y.normalize();
  const x = new THREE.Vector3(across[0], across[1], across[2]);
  if (x.lengthSq() < 1e-10) x.set(1, 0, 0);
  x.addScaledVector(y, -x.dot(y));
  if (x.lengthSq() < 1e-10) {
    x.set(1, 0, 0).addScaledVector(y, -y.x);
    if (x.lengthSq() < 1e-10) x.set(0, 0, 1);
  }
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
