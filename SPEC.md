# TrueCuts Specification

TrueCuts is a carpenter's CAD planner. A project is a YAML document: a list of **parts** cut from catalog stock, assembled into **components** in 3D. The editor is the source of truth in v1. The 3D view is a live visualization of that document.

This document is the format reference. v1 implements parts (lumber and sheet goods), planar cuts, components, and rendering. Hardware catalog entries and procedural components are specified here for later versions.

## Concepts

| Term | Meaning |
| --- | --- |
| Catalog part | A predefined stock item (a 2×4×8, a ¾″ 4×8 plywood sheet, a hinge, …). Identified by a catalog id such as `2x4x8`. |
| Part | One piece of the project, made by applying an ordered list of cuts to a catalog part. |
| Component | A named assembly: placed parts (and, later, nested components) relative to a local origin, then placed in world space. |
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
- `position` / `rotation` — place the component in world space.

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

v1 ships a small built-in dataset in `src/lib/catalog.ts`. Lumber uses **actual** dimensions (a 2×4 is 1.5″ × 3.5″). Sheet goods use listed thickness × 48″ × 96″. Hardware is catalogued for later rendering and procedural use.

| id | kind | actual L × W × T (in) | notes |
| --- | --- | --- | --- |
| `2x4x8` | lumber | 96 × 3.5 × 1.5 | pine |
| `2x4x10` | lumber | 120 × 3.5 × 1.5 | pine |
| `plywood-1/2-4x8` | sheet | 96 × 48 × 0.5 | |
| `plywood-3/4-4x8` | sheet | 96 × 48 × 0.75 | |
| `mdf-3/4-4x8` | sheet | 96 × 48 × 0.75 | |
| `screw-wood-8x2.5` | hardware | #8 × 2½″ wood screw | not rendered in v1 |
| `bolt-1/4-20x3` | hardware | ¼-20 × 3″ hex bolt | not rendered in v1 |
| `bracket-l-2x2` | hardware | 2″ × 2″ L-bracket | not rendered in v1 |
| `hinge-overlay-35mm` | hardware | 35 mm overlay hinge | not rendered in v1 |
| `drawer-slide-18` | hardware | 18″ side-mount slide (pair) | not rendered in v1 |

Catalog entries have `material` and `color` used by the viewport for lumber and sheet goods.

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
- Click a part to inspect `id`, stock, and finished AABB (length × width × thickness of the cut solid).
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
- Render hardware as solids / instances.
- Species / grain materials and joinery annotations.
