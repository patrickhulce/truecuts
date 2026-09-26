import { DEMO_YAML } from "./demo";

export type SampleBuild = {
  id: string;
  name: string;
  description: string;
  yaml: string;
};

export const BLANK_YAML = `version: 1
name: Untitled

members: []

components: []
`;

const SAWHORSE_YAML = `version: 1
name: Sawhorse

members:
  - label: Leg
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 32 }

  - label: Leg
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 32 }

  - label: Leg
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 32 }

  - label: Leg
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 32 }

  - label: Top
    stock: 2x6x8
    cuts:
      - { axis: 0, angle: 90, at: 36 }

components:
  - label: Horse
    position: [ 0, 0, 0 ]
    rotation: [ 0, 0, 0 ]
    members:
      - { id: leg-1, position: [ 2, 0, 0 ], rotation: [ 90, 90, 0 ] }
      - { id: leg-2, position: [ 30, 0, 0 ], rotation: [ 90, 90, 0 ] }
      - { id: leg-3, position: [ 2, 0, 4 ], rotation: [ 90, 90, 0 ] }
      - { id: leg-4, position: [ 30, 0, 4 ], rotation: [ 90, 90, 0 ] }
      - { id: top-1, position: [ 0, 32, -1 ], rotation: [ 0, 0, 0 ] }
`;

const BOOKSHELF_YAML = `version: 1
name: Bookshelf

members:
  - label: Side
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 36 }

  - label: Side
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 36 }

  - label: Shelf
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 24 }

  - label: Shelf
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 24 }

  - label: Shelf
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 24 }

components:
  - label: Case
    position: [ 0, 0, 0 ]
    rotation: [ 0, 0, 0 ]
    members:
      - { id: side-1, position: [ 0, 0, 0 ], rotation: [ 90, 90, 0 ] }
      - { id: side-2, position: [ 27.5, 0, 0 ], rotation: [ 90, 90, 0 ] }
      - { id: shelf-1, position: [ 3.5, 6, 0 ], rotation: [ 90, 0, 0 ] }
      - { id: shelf-2, position: [ 3.5, 18, 0 ], rotation: [ 90, 0, 0 ] }
      - { id: shelf-3, position: [ 3.5, 30, 0 ], rotation: [ 90, 0, 0 ] }
`;

const POST_AND_BEAM_YAML = `version: 1
name: Post and Beam

members:
  - label: Post
    stock: 6x6x8
    cuts:
      - { axis: 0, angle: 90, at: 30 }

  - label: Cap
    stock: connector-t
    size: [5.5, 5.5]

  - label: Beam
    stock: 6x6x8
    cuts:
      - { axis: 0, angle: 90, at: 12 }

  - label: Beam saddle
    stock: saddle
    size: [12, 5.5]

components:
  - label: Frame
    position: [ 0, 0, 0 ]
    rotation: [ 0, 0, 0 ]
    members:
      - { id: post-1, position: [ 0, 0, 0 ], rotation: [ 90, 90, 0 ] }
      - { id: cap-1, position: [ 0, 30, 0 ], rotation: [ 0, 0, 0 ] }
      - { id: beam-saddle-1, position: [ 5.5, 0, -0.25 ], rotation: [ 0, 0, 0 ] }
      - { id: beam-1, position: [ 5.5, 0.25, 0 ], rotation: [ 0, 0, 0 ] }
    connections:
      - members:
          - { id: cap-1 }
          - { id: post-1 }
        fasteners:
          - { kind: glue, stock: wood-glue }
      - members:
          - { id: beam-1 }
          - { id: post-1 }
        fasteners:
          - { kind: screw, stock: screw-wood-10x3, variant: { kind: centered, separation: 4, justify: space-around } }
      - members:
          - { id: beam-saddle-1 }
          - { id: beam-1 }
        fasteners:
          - { kind: bolt, stock: bolt-hex-1/2x6, variant: { kind: angle-bracket, bracket: beam-saddle-1, edge: 0.25 } }
`;

export const SAMPLE_BUILDS: SampleBuild[] = [
  {
    id: "assembly-bench",
    name: "Assembly Bench",
    description: "Shop demo with legs, aprons, brackets, a post cap, and a bolted saddle.",
    yaml: DEMO_YAML,
  },
  {
    id: "sawhorse",
    name: "Classic Sawhorse",
    description: "Four 2×4 legs under a 2×6 top.",
    yaml: SAWHORSE_YAML,
  },
  {
    id: "bookshelf",
    name: "Bookshelf",
    description: "Two sides and three shelves cut from 2×4s.",
    yaml: BOOKSHELF_YAML,
  },
  {
    id: "post-and-beam",
    name: "Timber Post & Beam",
    description: "6×6 post, T-connector cap, beam, and a bolted saddle.",
    yaml: POST_AND_BEAM_YAML,
  },
  {
    id: "blank",
    name: "Blank Project",
    description: "An empty document, ready for parts from the catalog.",
    yaml: BLANK_YAML,
  },
];
