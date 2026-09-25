"use client";

import type * as THREE from "three";

export function stripeCacheKey(): string {
  return "unfastened-stripes";
}

export function applyStripeShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
       varying vec3 vWorldStripe;`,
    )
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
       vWorldStripe = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
       varying vec3 vWorldStripe;`,
    )
    .replace(
      "#include <color_fragment>",
      `#include <color_fragment>
       float stripe = step(0.5, fract((vWorldStripe.x + vWorldStripe.y) * 0.45));
       diffuseColor.rgb = mix(vec3(1.0), vec3(0.86, 0.12, 0.12), stripe);`,
    );
}

/** Bands along the screw's local shank so the hatch shows on any world axis. */
export function screwStripeCacheKey(): string {
  return "covered-screw-stripes";
}

export function applyScrewStripeShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
       varying float vShankStripe;`,
    )
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
       vShankStripe = transformed.y;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
       varying float vShankStripe;`,
    )
    .replace(
      "#include <color_fragment>",
      `#include <color_fragment>
       float stripe = step(0.5, fract(vShankStripe * 4.0));
       diffuseColor.rgb = mix(vec3(1.0), vec3(0.86, 0.12, 0.12), stripe);`,
    );
}
