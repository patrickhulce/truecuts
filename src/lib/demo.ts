export const DEMO_YAML = `# TrueCuts demo — Assembly Bench
# Left: edit this YAML. Right: the 3D scene updates live.
# See SPEC.md for the full document format.
#
# Fasteners (screws, glue) join parts, including through L-bracket parts.
# Anything not reachable from the first part of the first component
# renders in red/white stripes.

version: 1
name: Assembly Bench

parts:
  - label: Leg
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 30 }

  - label: Leg
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 30 }

  - label: Leg
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 30 }

  - label: Leg
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 30 }

  - label: Long apron
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 33 }

  - label: Long apron
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 33 }

  - label: Short apron
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 21 }

  - label: Short apron
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 21 }

  - label: Brace
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 33 }

  - id: top-1
    label: Top
    stock: plywood-3/4-4x8
    cuts:
      - { axis: 0, angle: 90, at: 40 }
      - { axis: 1, angle: 90, at: 24 }

  - label: Shelf board
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 24 }

  - label: Spare block
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 8 }

  - label: Corner bracket
    stock: bracket-l-1.5x1.5

  - label: Corner bracket
    stock: bracket-l-1.5x1.5

  - label: Corner bracket
    stock: bracket-l-1.5x1.5

  - label: Corner bracket
    stock: bracket-l-1.5x1.5

components:
  - label: Bench
    position: [0, 0, 0]
    rotation: [0, 0, 0]
    parts:
      # Standing 2x4s: rotate 90° around Z so length (axis 0) stands up world Y.
      - { part: leg-1, position: [3.5, 0, 0], rotation: [0, 0, 90] }
      - { part: leg-2, position: [40, 0, 0], rotation: [0, 0, 90] }
      - { part: leg-3, position: [3.5, 0, 22.5], rotation: [0, 0, 90] }
      - { part: leg-4, position: [40, 0, 22.5], rotation: [0, 0, 90] }
      # Aprons sit on the 1.5" face, 3.5" tall, flush under the top.
      - { part: long-apron-1, position: [3.5, 26.5, 0], rotation: [0, 0, 0] }
      - { part: long-apron-2, position: [3.5, 26.5, 22.5], rotation: [0, 0, 0] }
      - { part: short-apron-1, position: [0, 26.5, 22.5], rotation: [0, 90, 0] }
      - { part: short-apron-2, position: [38.5, 26.5, 22.5], rotation: [0, 90, 0] }
      # Lower front stretcher between the front legs.
      - { part: brace-1, position: [3.5, 10, 0], rotation: [0, 0, 0] }
      # Plywood laid flat: rotate 90° around X so thickness stands on world Y.
      - { part: top-1, position: [0, 30.75, 0], rotation: [90, 0, 0] }
      # L-brackets under the long aprons, down the inner face of each leg.
      - { part: corner-bracket-1, position: [3.5, 26.5, 0], rotation: [90, 0, 0] }
      - { part: corner-bracket-2, position: [36.5, 26.5, 1.5], rotation: [90, 180, 0] }
      - { part: corner-bracket-3, position: [3.5, 26.5, 22.5], rotation: [90, 0, 0] }
      - { part: corner-bracket-4, position: [36.5, 26.5, 24], rotation: [90, 180, 0] }
    fasteners:
      # Apron-to-leg screws (head in the apron, tip into the leg).
      - stock: screw-wood-8x2.5
        members:
          - { part: long-apron-1, at: [0, 1.75, 0.75], direction: [-1, 0, 0] }
          - { part: leg-1, at: [28.25, 0, 0.75], direction: [0, -1, 0] }
      - stock: screw-wood-8x2.5
        members:
          - { part: long-apron-1, at: [33, 1.75, 0.75], direction: [1, 0, 0] }
          - { part: leg-2, at: [28.25, 3.5, 0.75], direction: [0, 1, 0] }
      - stock: screw-wood-8x2.5
        members:
          - { part: long-apron-2, at: [0, 1.75, 0.75], direction: [-1, 0, 0] }
          - { part: leg-3, at: [28.25, 0, 0.75], direction: [0, -1, 0] }
      - stock: screw-wood-8x2.5
        members:
          - { part: long-apron-2, at: [33, 1.75, 0.75], direction: [1, 0, 0] }
          - { part: leg-4, at: [28.25, 3.5, 0.75], direction: [0, 1, 0] }
      - stock: screw-wood-8x2.5
        members:
          - { part: short-apron-1, at: [21, 1.75, 0.75], direction: [1, 0, 0] }
          - { part: leg-1, at: [28.25, 2.75, 1.5], direction: [0, 0, 1] }
      - stock: screw-wood-8x2.5
        members:
          - { part: short-apron-1, at: [0, 1.75, 0.75], direction: [-1, 0, 0] }
          - { part: leg-3, at: [28.25, 2.75, 0], direction: [0, 0, -1] }
      - stock: screw-wood-8x2.5
        members:
          - { part: short-apron-2, at: [21, 1.75, 0.75], direction: [1, 0, 0] }
          - { part: leg-2, at: [28.25, 0.75, 1.5], direction: [0, 0, 1] }
      - stock: screw-wood-8x2.5
        members:
          - { part: short-apron-2, at: [0, 1.75, 0.75], direction: [-1, 0, 0] }
          - { part: leg-4, at: [28.25, 0.75, 0], direction: [0, 0, -1] }
      # Lower stretcher into the front legs.
      - stock: screw-wood-8x2.5
        members:
          - { part: brace-1, at: [0, 1.75, 0.75], direction: [-1, 0, 0] }
          - { part: leg-1, at: [11.75, 0, 0.75], direction: [0, -1, 0] }
      - stock: screw-wood-8x2.5
        members:
          - { part: brace-1, at: [33, 1.75, 0.75], direction: [1, 0, 0] }
          - { part: leg-2, at: [11.75, 3.5, 0.75], direction: [0, 1, 0] }
      # Screws through each bracket flange into the apron (up) and the leg.
      - stock: screw-wood-8x1.25
        members:
          - { part: corner-bracket-1, at: [0.75, 0.75, 0.125], direction: [0, 0, -1] }
          - { part: long-apron-1, at: [0.75, 0, 0.75], direction: [0, -1, 0] }
      - stock: screw-wood-8x1.25
        members:
          - { part: corner-bracket-1, at: [0.125, 0.75, 0.75], direction: [-1, 0, 0] }
          - { part: leg-1, at: [25.75, 0, 0.75], direction: [0, -1, 0] }
      - stock: screw-wood-8x1.25
        members:
          - { part: corner-bracket-2, at: [0.75, 0.75, 0.125], direction: [0, 0, -1] }
          - { part: long-apron-1, at: [32.25, 0, 0.75], direction: [0, -1, 0] }
      - stock: screw-wood-8x1.25
        members:
          - { part: corner-bracket-2, at: [0.125, 0.75, 0.75], direction: [-1, 0, 0] }
          - { part: leg-2, at: [25.75, 3.5, 0.75], direction: [0, 1, 0] }
      - stock: screw-wood-8x1.25
        members:
          - { part: corner-bracket-3, at: [0.75, 0.75, 0.125], direction: [0, 0, -1] }
          - { part: long-apron-2, at: [0.75, 0, 0.75], direction: [0, -1, 0] }
      - stock: screw-wood-8x1.25
        members:
          - { part: corner-bracket-3, at: [0.125, 0.75, 0.75], direction: [-1, 0, 0] }
          - { part: leg-3, at: [25.75, 0, 0.75], direction: [0, -1, 0] }
      - stock: screw-wood-8x1.25
        members:
          - { part: corner-bracket-4, at: [0.75, 0.75, 0.125], direction: [0, 0, -1] }
          - { part: long-apron-2, at: [32.25, 0, 0.75], direction: [0, -1, 0] }
      - stock: screw-wood-8x1.25
        members:
          - { part: corner-bracket-4, at: [0.125, 0.75, 0.75], direction: [-1, 0, 0] }
          - { part: leg-4, at: [25.75, 3.5, 0.75], direction: [0, 1, 0] }
      # Glue the top to all four aprons (one adhesive, many members).
      - stock: wood-glue
        members:
          - { part: top-1, at: [20, 12, 0.75], direction: [0, 0, 1] }
          - { part: long-apron-1, at: [16.5, 3.5, 0.75], direction: [0, 1, 0] }
          - { part: long-apron-2, at: [16.5, 3.5, 0.75], direction: [0, 1, 0] }
          - { part: short-apron-1, at: [10.5, 3.5, 0.75], direction: [0, 1, 0] }
          - { part: short-apron-2, at: [10.5, 3.5, 0.75], direction: [0, 1, 0] }
      # Screws through the top into each apron.
      - stock: screw-wood-8x1.25
        members:
          - { part: top-1, at: [20, 0.75, 0.75], direction: [0, 0, 1] }
          - { part: long-apron-1, at: [16.5, 3.5, 0.75], direction: [0, 1, 0] }
      - stock: screw-wood-8x1.25
        members:
          - { part: top-1, at: [20, 23.25, 0.75], direction: [0, 0, 1] }
          - { part: long-apron-2, at: [16.5, 3.5, 0.75], direction: [0, 1, 0] }
      - stock: screw-wood-8x1.25
        members:
          - { part: top-1, at: [0.75, 12, 0.75], direction: [0, 0, 1] }
          - { part: short-apron-1, at: [10.5, 3.5, 0.75], direction: [0, 1, 0] }
      - stock: screw-wood-8x1.25
        members:
          - { part: top-1, at: [39.25, 12, 0.75], direction: [0, 0, 1] }
          - { part: short-apron-2, at: [10.5, 3.5, 0.75], direction: [0, 1, 0] }

  - label: Shelf
    position: [8, 26.5, 24]
    parts:
      - { part: shelf-board-1, position: [0, 0, 0], rotation: [0, 0, 0] }

  # Leftover cut-off on the floor — not fastened, so it stripes.
  - label: Spare
    position: [50, 0, 8]
    parts:
      - { part: spare-block-1, position: [0, 0, 0], rotation: [0, 0, 0] }

# Document-level fastener: glue the shelf component to the bench.
fasteners:
  - stock: wood-glue
    members:
      - { component: bench-1, part: long-apron-2, at: [16.5, 1.75, 1.5], direction: [0, 0, 1] }
      - { component: shelf-1, part: shelf-board-1, at: [12, 1.75, 0], direction: [0, 0, -1] }
`;
