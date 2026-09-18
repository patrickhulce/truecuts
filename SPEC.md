# TrueCuts Specification

TrueCuts is a carpenter's CAD planner. A project is a YAML document: a list of **parts** cut from catalog stock, assembled into **components** in 3D, then joined with **fasteners**. The editor is the source of truth in v1. The 3D view is a live visualization of that document.

This document is the format reference. v1 implements parts (lumber, sheet goods, and L-brackets), planar cuts, components, fasteners (screws, wood glue), and rendering. Remaining hardware catalog entries and procedural components are specified here for later versions.

## Concepts

| Term | Meaning |
| --- | --- |
| Catalog part | A predefined stock item (a 2×4×8, a ¾″ 4×8 plywood sheet, a hinge, …). Identified by a catalog id such as `2x4x8`. |
| Part | One piece of the project, made by applying an ordered list of cuts to a catalog part. |
| Component | A named assembly: placed parts (and, later, nested components) relative to a local origin, then placed in world space. |
| Fastener | A catalogued connector (screw or glue). It references two or more placed parts at a centerpoint on each, and is never cut stock. |
| Procedural component | A generator that emits a component from parameters (a drawer of given W×D×H). Specified below; not implemented in v1. |

## Identity

Every part and every component has:

- `label` (required) — human-readable name, any string.
- `id` (optional) — stable machine id. References always use `id`, never `label`.

When `id` is omitted it is derived as `kebab(label)` plus a per-document, per-slug 1-based index:

- `Leg` → `leg-1`, then `leg-2`
- `Cabinet Door` → `cabinet-door-1`

The index is assigned in document order, grouped by `kebab(label)`, skipping numbers already taken by explicit ids. If labels are unchanged, ids are stable across edits.

Explicit ids must match:

```
/^[a-z0-9]+(-[a-z0-9]+)*-\d+$/
```

Examples: `leg-1`, `top-1`, `cabinet-door-12`. `Leg`, `rail`, and `top_1` are invalid.

Part ids and component ids share one document-wide namespace. Duplicate ids are an error. Component `parts[].part` values must resolve to a part id.

## Units and coordinates

- Internal unit: **inches**.
- World: right-handed, **Y-up**.
- Part local axes: **0 = length** (grain, +X), **1 = width** (+Y), **2 = thickness** (+Z).
- Part origin is the **min corner** of the uncut stock. `at` is measured from that origin along the cut axis.
- Rotations are Euler **XYZ** in **degrees**.
- Positions are `[x, y, z]` in inches (numbers or dimension strings).

### Dimension strings

A dimension is a YAML number (inches) or a string:

| Input | Inches |
| --- | --- |
| `34` | 34 |
| `"8\""` / `8"` | 8 |
| `"3/4\""` | 0.75 |
| `"6 1/2\""` | 6.5 |
| `"1'"` | 12 |
| `"1'-6\""` | 18 |
| `"1'-6 1/2\""` | 18.5 |
| `"34.5\""` | 34.5 |

Strings that contain `"` must be YAML-quoted. Bare numbers are inches and are preferred in examples.

## YAML document

```yaml
version: 1
name: Sawhorse
parts:
  - label: Leg                 # id defaults to leg-1
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 34 }
  - label: Rail                # id defaults to rail-1
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 45, at: [44, 48] }
      - { axis: 0, angle: 45, at: [0, 4], side: start }
  - id: top-1                  # explicit id (must still end in -<index>)
    label: Top
    stock: plywood-3/4-4x8
    cuts:
      - { axis: 0, angle: 90, at: 60 }
      - { axis: 1, angle: 90, at: 30 }
components:
  - label: Horse               # id defaults to horse-1
    parts:
      - { part: leg-1, position: [0, 0, 0], rotation: [0, 0, 0] }
      - { part: top-1, position: [0, 34, 0], rotation: [0, 0, 0] }
    position: [0, 0, 0]
    rotation: [0, 0, 0]
```

### Document fields

- `version` — must be `1`.
- `name` — project title.
- `parts` — list of parts (default empty).
- `components` — list of components (default empty). Only parts referenced by a component are drawn.
- `fasteners` — document-level fasteners that may join parts in different components (default empty).

### Part fields

- `label` — required.
- `id` — optional; see Identity.
- `stock` — catalog id.
- `cuts` — ordered list of planar cuts, applied in stock-local coordinates. Empty means the full stock piece.

### Cut fields

- `axis` — `0`, `1`, or `2`. The axis the cut plane is **perpendicular to at 90°**.
- `angle` — degrees. `90` is square. Other values tilt the plane away from square (miter / bevel).
- `at` — a single measurement for square cuts, or `[short, long]` short-point / long-point for angled cuts.
- `side` — `end` (default) or `start`. `end` keeps material from the origin up to the plane; `start` keeps material past the plane.
- `around` — optional tilt axis. Default is a **miter across the width face** (`around: 2` when `axis` is not 2; `around: 1` when cutting on thickness). Set `around: 1` on a length cut for a **bevel**.

Validation:

- Range `[short, long]` is required if and only if `angle` is not 90.
- `short < long`.
- Both values lie on the stock extent of `axis` (0 through the actual dimension).

Cuts are sequential and all measured from the original stock origin. Two end miters:

```yaml
cuts:
  - { axis: 0, angle: 45, at: [44, 48] }            # far end, keep toward origin
  - { axis: 0, angle: 45, at: [0, 4], side: start }  # near end, keep the rest
```

### Component fields

- `label` / `id` — as for parts.
- `parts` — placements. `part` is a part **id**. `position` and `rotation` are relative to the component origin (defaults `[0, 0, 0]`).
- `fasteners` — fasteners whose members are parts of this component. Members omit `component` (it is implied).
- `position` / `rotation` — place the component in world space.

## Fasteners

A fastener is catalogued hardware that joins placed parts. It is never a `parts[]` entry (`renderable` is false for stock use). Two YAML homes share the same member idea:

**Inside a component** — two (or more, for glue) parts, each with a part-local centerpoint and optional direction:

```yaml
components:
  - label: Bench
    parts: [...]
    fasteners:
      - stock: screw-wood-8x2.5
        members:
          - { part: leg-1, at: [0.75, 28.25, 0.75], direction: [0, 0, 1] }
          - { part: long-apron-1, at: [2, 1.75, 0], direction: [0, 0, -1] }
```

**Document-level** — same `at` / `direction`, plus `component` and `part` so a glue-up can span assemblies:

```yaml
fasteners:
  - stock: wood-glue
    members:
      - { component: bench-1, part: top-1, at: [20, 12, 0], direction: [0, 0, 1] }
      - { component: shelf-1, part: shelf-board-1, at: [10, 6, 0.75], direction: [0, 0, -1] }
```

### Fastener fields

- `stock` — catalog id of kind `fastener` (`screw` or `glue`).
- `members` — two or more attachments.

### Member fields

- `part` — part **id**.
- `component` — required on document-level members; forbidden on component-level members (implied).
- `index` — 0-based occurrence of that part id in the component's `parts` list (default `0`).
- `at` — fastener centerpoint in **part-local** space (min-corner origin, same as cuts).
- `direction` — part-local vector. For screws, first member is the **head side** and the vector points **head → tip**. Required on every screw member; optional for glue.

Rules:

- Screws require exactly two members. Glue requires two or more.
- Members must name a part that is actually placed in the referenced component, including L-bracket hardware parts (a screw through a bracket names the bracket and the wood it bites).

Connectivity: fasteners are undirected edges between member instances (glue with N members is a clique). The **seed** is the first part of the first component. Any instance not reachable from the seed is drawn with red/white hazard stripes. The seed itself is always treated as fastened.

## Cut semantics

A cut is a plane. The remaining solid is the convex polyhedron on the kept side of that plane (Sutherland–Hodgman clipping plus a cap face). Boxes stay convex under planar cuts; dados and other non-convex features are out of scope for v1.

### Square crosscut

At `angle: 90` the plane is perpendicular to `axis` at `at`.

```
axis 0, angle 90, at 34, side: end

X=0                         X=34              X=96
|---------------------------|==================|   discarded
 origin                     plane
 <----------- kept -------->
```

`side: start` keeps `X >= 34` instead.

### Miter (short / long point)

`at: [short, long]` places the short point on the **min** face of the span axis and the long point on the **max** face. For a default length-axis miter, the span is width (axis 1):

```
Y = width
 *------------------------------------*
 |                                    \
 |                                     \
 |                                      \
 *---------------------------------------*
 X=0                                  short  long
                                      (Y=0)  (Y=width)
```

The plane contains both points and is parallel to `around` (thickness, by default). `angle` records the carpenter's miter angle; the plane is built from the short/long points. For a 45° miter across a 3.5″ 2×4, `long - short` should be 3.5″.

### Bevel

Same as a miter, but `around` is the width axis so short/long vary across thickness.

### Sequential cuts

Each cut clips whatever remains. Both ends of a board can be mitered by following a far-end `side: end` cut with a near-end `side: start` cut, as in the example above.

## Catalog

v1 ships a small built-in dataset in `src/lib/catalog.ts`. Lumber uses **actual** dimensions (a 2×4 is 1.5″ × 3.5″). Sheet goods use listed thickness × 48″ × 96″. Angle L-brackets (`bracket-l-*`, two square flanges at 90°) and flat L-brackets (`bracket-flat-l-*`, a single-plane L plate) are renderable hardware parts; they do not take planar cuts. Fasteners (screws, glue) are rendered as instances. Other hardware is catalogued for later rendering and procedural use.

| id | kind | actual L × W × T (in) | notes |
| --- | --- | --- | --- |
| `2x4x8` | lumber | 96 × 3.5 × 1.5 | pine |
| `2x4x10` | lumber | 120 × 3.5 × 1.5 | pine |
| `plywood-1/2-4x8` | sheet | 96 × 48 × 0.5 | |
| `plywood-3/4-4x8` | sheet | 96 × 48 × 0.75 | |
| `mdf-3/4-4x8` | sheet | 96 × 48 × 0.75 | |
| `screw-wood-6x1.25` | fastener | #6 × 1¼″ wood screw | rendered as a fastener |
| `screw-wood-8x1.25` | fastener | #8 × 1¼″ wood screw | rendered as a fastener |
| `screw-wood-8x2` | fastener | #8 × 2″ wood screw | rendered as a fastener |
| `screw-wood-8x2.5` | fastener | #8 × 2½″ wood screw | rendered as a fastener |
| `screw-wood-10x3` | fastener | #10 × 3″ wood screw | rendered as a fastener |
| `wood-glue` | fastener | wood glue bead | rendered as a fastener |
| `bracket-l-1.5x1.5` | hardware | 1½″ × 1½″ angle L-bracket | placed as a part |
| `bracket-l-2x2` | hardware | 2″ × 2″ angle L-bracket | placed as a part |
| `bracket-flat-l-2x1` | hardware | 2″ × 1″ flat L-bracket | placed as a part |
| `bracket-flat-l-3x1` | hardware | 3″ × 1″ flat L-bracket | placed as a part |
| `bolt-1/4-20x3` | hardware | ¼-20 × 3″ hex bolt | not rendered in v1 |
| `hinge-overlay-35mm` | hardware | 35 mm overlay hinge | not rendered in v1 |
| `drawer-slide-18` | hardware | 18″ side-mount slide (pair) | not rendered in v1 |

Catalog entries have `material` and `color` used by the viewport for lumber, sheet goods, L-brackets, and fastener solids.

L-bracket part axes: origin at the inside corner. Axis 0 is the first flange (+X), axis 1 is the fold width (+Y), axis 2 is the second flange (+Z). Plate thickness is `size[2]`. Planar cuts are not allowed.

Flat L-bracket part axes: origin at the outer corner of a single-plane L in XY. Axis 0 is the first leg (+X), axis 1 is the second leg (+Y), axis 2 is plate thickness (+Z). `size` is `[leg, arm width, thickness]`. Planar cuts are not allowed.

## Procedural components

Not generated in v1. The interface is:

```ts
type ProceduralGenerator = {
  id: string;
  label: string;
  description: string;
  generate: (params: { width: number; height: number; depth?: number; [k: string]: unknown }) => Component;
};
```

Registry: `src/lib/procedural.ts` (`proceduralRegistry`). Planned generators:

### `drawer`

Parameters: `width`, `depth`, `height` (inside or overall — overall, including material). Emits:

- Box sides, front, back, and bottom from catalog sheet stock, cut to size.
- A pair of drawer slides (`drawer-slide-18` or a length nearest `depth`), placed on the sides.
- Joinery is butt joints unless a later option selects otherwise.

YAML sketch (future):

```yaml
components:
  - label: Shop drawer
    procedural: drawer
    params: { width: 18, depth: 20, height: 6 }
    position: [0, 0, 0]
```

### `cabinet-door`

Parameters: `width`, `height`, `depth` (panel thickness, default ¾″), optional `overlay` (`full` / `half` / `inset`). Emits:

- A door slab from sheet stock.
- Hinges (`hinge-overlay-35mm` by default). Count and spacing are chosen from door height (two hinges below ~40″, three above, four above ~80″), inset from the top and bottom (~3″, more on tall doors). After generation the hinge placements are ordinary component parts and can be adjusted in YAML.

```yaml
components:
  - label: Upper door
    procedural: cabinet-door
    params: { width: 15, height: 30, depth: 0.75 }
```

## Rendering

- Left pane: YAML editor (CodeMirror) with a walnut/amber theme and lint markers on diagnostics.
- Right pane: react-three-fiber scene — warm hemisphere + shadowed directional light, 1″ grid with 12″ sections, orbit controls, wood-tone materials with CAD edges.
- Click a part to inspect `id`, stock, finished AABB (length × width × thickness of the cut solid), whether it is fastened, and the fasteners attached to it. Non-selected parts fade so fasteners inside the assembly stay visible; attached fasteners highlight.
- Fasteners render as solids: screws (head + shank) and glue beads at each member `at`. L-brackets render as ordinary steel parts.
- An explode slider radiates parts from the scene center (distance-proportional); fasteners travel with their members.
- Any part not reachable from the first part of the first component is drawn with red/white hazard stripes.
- The document autosaves to `localStorage`. **Reset demo** restores `examples/demo.yaml`.
- Invalid YAML or validation errors keep the last good scene from rendering; the viewport shows a placeholder until the document compiles.

Edits are one-way in v1 (YAML → 3D). GUI → YAML round-trip is on the roadmap.

## Roadmap

- Bidirectional GUI editing (select/move in 3D writes YAML; form editors for cuts).
- Nested components.
- Dados, rabbets, and other non-convex cuts (true CSG).
- Cut-list optimizer (nest parts onto stock, kerf, waste).
- CSV / STL export.
- Implement procedural `drawer` and `cabinet-door`.
- Render remaining hardware (bolts, hinges, slides) as solids / instances.
- Species / grain materials and joinery annotations.
