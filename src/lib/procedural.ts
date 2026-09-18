import type { ResolvedComponent } from "./schema";

export type ProceduralParams = {
  width: number;
  height: number;
  depth?: number;
  [key: string]: unknown;
};

export type ProceduralGenerator = {
  id: string;
  label: string;
  description: string;
  generate: (params: ProceduralParams) => ResolvedComponent;
};

/**
 * Registry of procedural components (drawer, cabinet door, …).
 * v1 documents the interface in SPEC.md; generators are not implemented yet.
 */
export const proceduralRegistry: Record<string, ProceduralGenerator> = {};
