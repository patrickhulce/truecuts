# TrueCuts Specification

TrueCuts is a carpenter's CAD planner. A project is a YAML document: **members** cut from catalog **stock**, assembled into **components**, then joined by **connections** (recipes of **fasteners** and the **bores** those fasteners need). A **part** is anything on the purchase and cut list — a member or a fastener. The editor is the source of truth in v1. The 3D view is a live visualization of that document.

This document is the format reference. v1 implements members (lumber, sheet goods, L-brackets, and parameterized post hardware), planar cuts, components, connections (screws, bolts, and wood glue), explicit fasteners as a hand-placed escape hatch, and rendering. Hinges, drawer slides, and procedural components are specified here for later versions.

## Concepts

| Term | Meaning |
| --- | --- |
| Component | A large grouping of a build: placed members (and, later, nested components) relative to a local origin, then placed in world space. |
| Member | A block of wood, or a hardware part such as a bracket, cut from stock. YAML key `members`. |
| Stock | Raw material from the store. A catalog entry such as `2x4x8`. |
| Cut | A planar slice that converts stock into a member. |
| Bore | A depression or hole drilled in a member. Authored bores use YAML key `bores`. Pilot and clearance bores for a connection are derived, not authored. |
| Fastener | A screw, glue bead, bolt, dowel, cam, bracket, or similar that connects members. A fastener may be a rendered member (a bracket) or a non-stock instance (a screw or glue bead). |
| Connection | The system of fastener recipes, and the bores those recipes imply, that joins two or more members. |
| Part | Any member or fastener in the build — the purchase and cut list. |
| Procedural component | A generator that emits a component from parameters (a drawer of given W×D×H). Specified below; not implemented in v1. |

## Identity

Every member and every component has:

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

Member ids and component ids share one document-wide namespace. Duplicate ids are an error. Component `members[].id` values must resolve to a member id.

## Units and coordinates

- Internal unit: **inches**.
- World: right-handed, **Y-up**.
- Parts keep their **trade names** (a 2×4 is still called a 2×4). Every **numeric** dimension is **L×W×T**, longest → shortest. A 2×4×8 is `[96, 3.5, 1.5]` = 8′ × 3.5″ × 1.5″.
- Cut axes index that tuple: **0 = length (L)**, **1 = width (W)**, **2 = thickness (T)**.
- Default local frame: **X = L**, **Z = W**, **Y = T**. Default placement sits `LxW@0` on the ground, thickness along +Y.
- A member face is the two axes that span it, earlier dimension first (L, then W, then T), plus which side:
  - `@0` — the plane through the part origin (coordinate 0 on the axis that is not in the name)
  - `@1` — the opposite plane, at the catalog stock extent of that axis
  - `LxW@0` / `LxW@1` — wide faces, T = 0 / T = stock T, outward normal −Y / +Y
  - `LxT@0` / `LxT@1` — edges, W = 0 / W = stock W, outward normal −Z / +Z
  - `WxT@0` / `WxT@1` — ends, L = 0 / L = stock L, outward normal −X / +X
- These ids name stock planes. A crosscut does not move `@1`; the cut cap is a new mesh polygon and is not a face id.
- Member origin is the **min corner** of the uncut stock. A cut's `at` is measured from that origin along the cut axis (L, W, or T — not a world XYZ coordinate). A position on a face is measured from that origin along the two axes written in the face id.
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
members:
  - label: Leg                 # id defaults to leg-1
    stock: 2x4x8               # L×W×T = 8′ × 3.5″ × 1.5″
    cuts:
      - { axis: 0, angle: 90, at: 34 }   # square cut on L
  - label: Rail                # id defaults to rail-1
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 45, at: [44, 48] }
      - { axis: 0, angle: 45, at: [0, 4], side: start }
  - id: top-1                  # explicit id (must still end in -<index>)
    label: Top
    stock: plywood-3/4-4x8     # L×W×T = 8′ × 4′ × ¾″; LxW@0 is default-down
    cuts:
      - { axis: 0, angle: 90, at: 60 }
      - { axis: 1, angle: 90, at: 30 }
components:
  - label: Horse               # id defaults to horse-1
    members:
      # Standing 2×4: rotation [90, 90, 0] sends L up world Y.
      - { id: leg-1, position: [0, 0, 0], rotation: [90, 90, 0] }
      # Sheet goods sit flat by default (T along +Y); no rotation needed.
      - { id: top-1, position: [0, 34, 0], rotation: [0, 0, 0] }
    connections:
      - members:
          - { id: top-1 }
          - { id: leg-1 }
        fasteners:
          - kind: screw
            stock: screw-wood-8x2
            variant: { kind: four-corners, edge: 0.75 }
    position: [0, 0, 0]
    rotation: [0, 0, 0]
```

### Document fields

- `version` — must be `1`.
- `name` — project title.
- `members` — list of members (default empty).
- `components` — list of components (default empty). Only members referenced by a component are drawn.
- `connections` — document-level connections that may join members in different components (default empty).
- `fasteners` — hand-placed fastener instances (default empty). Prefer `connections`; this list is the escape hatch.

### Member fields

- `label` — required.
- `id` — optional; see Identity.
- `stock` — catalog id.
- `size` — optional list of 1–3 dimensions for parameterized stock. Values apply to the free axes in L, W, T order, skipping any axis the catalog marks fixed. Omitted free axes use the catalog default. `size` on stock that is not parameterized, a value past the free axes, or a value outside that axis's min/max is an error. A fixed axis (bracket gauge, T-connector stem height) does not change when a free axis does.
- `cuts` — ordered list of planar cuts, applied in stock-local coordinates. Empty means the full stock piece. Box stock only; hardware geometries reject cuts.
- `bores` — optional drilled bores on stock faces (default empty). Each bore is cut out of the rendered mesh. Contact and finished volume still use the cut stock before the bores. Connection pilot and clearance bores are computed and are not written here.

### Cut fields

- `axis` — `0` (L), `1` (W), or `2` (T). The dimension the cut plane is **perpendicular to at 90°**. Not a world XYZ index.
- `angle` — degrees. `90` is square. Other values tilt the plane away from square (miter / bevel).
- `at` — a single measurement for square cuts, or `[short, long]` short-point / long-point for angled cuts.
- `side` — `end` (default) or `start`. `end` keeps material from the origin up to the plane; `start` keeps material past the plane.
- `around` — optional tilt axis (also L/W/T). Default is a miter parallel to T (`around: 2` when `axis` is not 2; `around: 1` when cutting on thickness). A length cut then runs from `LxT@0` (short) to `LxT@1` (long) and is read on `LxW@0` and `LxW@1`. Set `around: 1` on a length cut for a **bevel** (short/long vary across T, from `LxW@0` to `LxW@1`).

Validation:

- Range `[short, long]` is required if and only if `angle` is not 90.
- `short < long`.
- Both values lie on the stock extent of `axis` (0 through the actual dimension).

### Bore fields

- `face` — one of `LxW@0`, `LxW@1`, `LxT@0`, `LxT@1`, `WxT@0`, `WxT@1`.
- `at` — `[first, second]` on that face, inches from the member origin along the two axes in the order written in the id. `LxW` uses `[L, W]`, `LxT` uses `[L, T]`, `WxT` uses `[W, T]`.
- `diameter` — inches (a number or a dimension string).
- `depth` — optional inches inward from the face, along the inward normal. Omit it to bore through the stock. The through length is the stock extent of the axis that is not in the face id (`T` for `LxW`, `W` for `LxT`, `L` for `WxT`).

```yaml
bores:
  - { face: LxW@1, at: [20, 12], diameter: 1, depth: 0.5 }
```

Validation:

- `diameter` is greater than 0.
- `depth`, when set, is greater than 0 and no deeper than the stock extent along the face normal. A depth that meets the opposite stock plane is through.
- The center lies on the stock face (each `at` component is between 0 and that axis's stock extent).
- The circle stays inside the stock rectangle (the center is inset from each edge by the radius).

A bore whose center lies in material a later cut removes still resolves. The bore is cut from the remaining mesh. Face ids address the stock planes, not cut caps.

Cuts are sequential and all measured from the original stock origin. Two end miters:

```yaml
cuts:
  - { axis: 0, angle: 45, at: [44, 48] }            # far end, keep toward origin
  - { axis: 0, angle: 45, at: [0, 4], side: start }  # near end, keep the rest
```

### Component fields

- `label` / `id` — as for members.
- `members` — placements. `id` is a member **id**. `position` and `rotation` are relative to the component origin (defaults `[0, 0, 0]`).
- `connections` — connection recipes whose members are placed in this component. Member entries omit `component` (it is implied).
- `fasteners` — hand-placed fastener instances whose members are placed in this component. Members omit `component`.
- `position` / `rotation` — place the component in world space.

## Connections

A connection is a recipe. It names two or more placed members and one or more fastener recipes. Expansion finds the contact patch between those members, lays out points, and emits fastener instances plus derived bores. The first member is the screw head side. If a named member never touches another member of the connection, the scene keeps a warning and still renders.

```yaml
connections:
  - members:
      - { id: long-apron-1 }
      - { id: leg-1 }
    fasteners:
      - kind: screw
        stock: screw-wood-8x2.5
        variant:
          kind: perimeter
          edge: 0.75
          separation: 4
          justify: space-between
```

`members[]` entries are `{ id, component?, index? }`. `component` is required at document level and forbidden inside a component. `index` is the 0-based placement occurrence (default `0`).

`fasteners[]` is a discriminated union on `kind`. `stock` must be a catalog entry of kind `fastener` whose subtype matches `kind`, except `none`, which has no stock. Each entry is a recipe, not one instance. `variant` is itself a discriminated object, so a layout only carries the options that apply to it:

- `screw` / `four-corners` — `{ edge }`. One screw near each corner of the contact patch, inset by `edge`.
- `screw` / `angle-bracket` — `{ bracket, edge }`. `bracket` is a member id that is one of the connection members. One screw on the largest patch between the bracket and each other member, at the centroid of the inset.
- `screw` / `perimeter` — `{ edge, separation, justify }`. Screws around the inset boundary.
- `screw` / `centered` — `{ separation, justify }`. Screws along the patch centerline. No `edge`.
- `glue` — `variant` defaults to `{ kind: patch }` (a bead at the patch centroid). `{ kind: edge, edge }` places the bead in from the longest edge.
- `bolt` / `through` — `{ at? }`. A through-bore at the patch centroid, or at an explicit patch position.
- `bolt` / `angle-bracket` — `{ bracket, edge }`. `bracket` is a member id that is one of the connection members. Same layout as the screw angle-bracket, on every contact patch between the bracket and each other member (a saddle fastens both flanges, not only the largest). Clearance bores run through the bracket and the wood.
- `none` — `{ kind: none }`. No stock or variant. The connection stays, but this recipe adds no fastener, bore, or joint.

`justify` is `space-between` or `space-around`. `separation` is the **maximum** gap. The layout chooses the count and the actual distance: `space-between` pins fasteners to both ends of an open path (or starts a closed path at the first vertex); `space-around` leaves a half-gap at each end of an open path (or offsets a closed path by half a gap).

Derived bores merge with the member's authored `bores` for meshing and cut lists:

- **Screw** — a pilot in the receiving member (diameter is 0.7× the screw's major diameter). When the screw is longer than the head member's thickness along the screw axis, a clearance bore (major diameter) goes through the head and the pilot depth is what remains of the screw. A butt screw that does not span the head starts at the contact and pilots only the tip.
- **Bolt** — a clearance bore through every member the bolt passes, diameter equal to the bolt diameter. The rendered solid is one purchase-list line: hex head, washer, shank, washer, and nut. Head, washer, and nut diameters follow the shank diameter; a longer bolt is not a fatter bolt. The nut sits at the grip (head face to the far exit). A bolt shorter than that grip keeps a warning.
- **Glue** — no bores.

## Fasteners

An explicit fastener is a hand-placed instance: catalog stock plus a centerpoint on each member. It is the escape hatch when a connection recipe is not enough. It is never a `members[]` entry (`renderable` is false for stock use). Connections are the usual way to join members.

**Inside a component** — two (or more, for glue) members, each with a member-local centerpoint and optional direction:

```yaml
components:
  - label: Bench
    members: [...]
    fasteners:
      - stock: screw-wood-8x2.5
        members:
          - { id: leg-1, at: [0.75, 28.25, 0.75], direction: [0, 0, 1] }
          - { id: long-apron-1, at: [2, 1.75, 0], direction: [0, 0, -1] }
```

**Document-level** — same `at` / `direction`, plus `component` and `id` so a glue-up can span assemblies:

```yaml
fasteners:
  - stock: wood-glue
    members:
      - { component: bench-1, id: top-1, at: [20, 12, 0], direction: [0, 0, 1] }
      - { component: shelf-1, id: shelf-board-1, at: [10, 6, 0.75], direction: [0, 0, -1] }
```

### Fastener fields

- `stock` — catalog id of kind `fastener` (`screw`, `bolt`, or `glue`).
- `members` — two or more attachments.

### Member fields

- `id` — member **id**.
- `component` — required on document-level members; forbidden on component-level members (implied).
- `index` — 0-based occurrence of that member id in the component's `members` list (default `0`).
- `at` — fastener centerpoint in **member-local** space (min-corner origin, same as cuts).
- `direction` — member-local vector. For screws, first member is the **head side** and the vector points **head → tip**. Required on every screw member; optional for glue.

Rules:

- Screws and bolts require exactly two members, and every member needs `direction` (head → tip). Glue requires two or more.
- Members must name a member that is actually placed in the referenced component, including L-bracket hardware members (a screw through a bracket names the bracket and the wood it bites).

Connectivity: fasteners and expanded connections are undirected edges between member instances (glue with N members is a clique). The **seed** is the first member of the first component. Any instance not reachable from the seed is drawn with red/white hazard stripes. The seed itself is always treated as fastened.

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

`at: [short, long]` places the short point on the `@0` face of the span axis and the long point on the `@1` face. For a default length-axis miter, the span is width (axis 1, local +Z), so the short point is on `LxT@0` and the long point is on `LxT@1`. The plane is parallel to T, and the cut line is read on `LxW@0` and `LxW@1`:

```
Z = width
 *------------------------------------*
 |                                    \
 |                                     \
 |                                      \
 *---------------------------------------*
 X=0                                  short  long
                                      (Z=0)  (Z=width)
```

The plane contains both points and is parallel to `around` (thickness / local +Y, by default). `angle` records the carpenter's miter angle; the plane is built from the short/long points. For a 45° miter across a 3.5″ 2×4, `long - short` should be 3.5″.

### Bevel

Same as a miter, but `around` is the width axis so short/long vary across thickness (local +Y).

### Sequential cuts

Each cut clips whatever remains. Both ends of a board can be mitered by following a far-end `side: end` cut with a near-end `side: start` cut, as in the example above.

## Catalog

v1 ships a small built-in dataset in `src/lib/catalog.ts`. Catalog `size` is always **actual L×W×T**, longest → shortest (a 2×4×8 is 8′ × 3.5″ × 1.5″). Trade names stay (it is still a 2×4). Sheet goods are 96″ × 48″ × listed thickness. Lumber and sheet goods are discrete rows: a 2×10 is not a scaled 2×4, because actual thickness stays 1.5″ while actual width changes. Angle L-brackets, flat L-brackets, the post-to-beam T-connector, and the post saddle are renderable hardware members; they do not take planar cuts. Round rods are renderable hardware too. A rod is a round prism inscribed in its L×W×T box, and it takes the same planar cuts as lumber. Fasteners (screws, bolts, glue) are rendered as instances. Hinges and drawer slides are catalogued for later rendering and procedural use.

Parameterized stock (`bracket-l`, `connector-t`, `saddle`) stores a spec per axis. A member's `size` lists only the free axes. Fixed axes and extra features stay at the catalog value, so lengthening a plate does not thicken it or change stem or flange height.

```yaml
- { label: Post cap, stock: connector-t, size: [7.5, 5.5] }  # L and W; gauge stays 1/4″, riser stays 3″
- { label: Post bracket, stock: bracket-l, size: [6, 4] }    # leg and fold; gauge stays 1/8″
```

| id | kind | actual L × W × T (in) | notes |
| --- | --- | --- | --- |
| `2x4x8` | lumber | 96 × 3.5 × 1.5 | pine |
| `2x4x10` | lumber | 120 × 3.5 × 1.5 | pine |
| `2x6x8` | lumber | 96 × 5.5 × 1.5 | pine |
| `2x6x10` | lumber | 120 × 5.5 × 1.5 | pine |
| `2x6x12` | lumber | 144 × 5.5 × 1.5 | pine |
| `6x6x8` | lumber | 96 × 5.5 × 5.5 | pine |
| `6x6x10` | lumber | 120 × 5.5 × 5.5 | pine |
| `6x6x12` | lumber | 144 × 5.5 × 5.5 | pine |
| `plywood-1/4-4x8` | sheet | 96 × 48 × 0.25 | |
| `plywood-3/8-4x8` | sheet | 96 × 48 × 0.375 | |
| `plywood-1/2-4x8` | sheet | 96 × 48 × 0.5 | |
| `plywood-5/8-4x8` | sheet | 96 × 48 × 0.625 | |
| `plywood-3/4-4x8` | sheet | 96 × 48 × 0.75 | |
| `mdf-1/4-4x8` | sheet | 96 × 48 × 0.25 | |
| `mdf-1/2-4x8` | sheet | 96 × 48 × 0.5 | |
| `mdf-3/4-4x8` | sheet | 96 × 48 × 0.75 | |
| `screw-wood-6x1.25` | fastener | #6 × 1¼″ wood screw | rendered as a fastener |
| `screw-wood-8x1.25` | fastener | #8 × 1¼″ wood screw | rendered as a fastener |
| `screw-wood-8x2` | fastener | #8 × 2″ wood screw | rendered as a fastener |
| `screw-wood-8x2.5` | fastener | #8 × 2½″ wood screw | rendered as a fastener |
| `screw-wood-10x3` | fastener | #10 × 3″ wood screw | rendered as a fastener |
| `wood-glue` | fastener | wood glue bead | rendered as a fastener |
| `bracket-l-1.5x1.5` | hardware | 1½″ × 1½″ angle L-bracket | placed as a part; gauge ⅛″ |
| `bracket-l-2x2` | hardware | 2″ × 2″ angle L-bracket | placed as a part; gauge ⅛″ |
| `bracket-l` | hardware | angle L-bracket | L and W each 1.5–12 (default 2); gauge fixed ⅛″ |
| `bracket-flat-l-2x1` | hardware | 2″ × 1″ flat L-bracket | placed as a part |
| `bracket-flat-l-3x1` | hardware | 3″ × 1″ flat L-bracket | placed as a part |
| `connector-t` | hardware | post-to-beam T | L and W each 3.5–12 (default 5.5); gauge fixed ¼″; stem height fixed 3″ |
| `saddle` | hardware | post saddle | L and inside width W each 1.5–12 (default 5.5); gauge fixed ¼″; flange height fixed 2″ |
| `rod-1x12` | hardware | 12 × 1 × 1 | black round bar, 1″ diameter |
| `rod-1x16` | hardware | 16 × 1 × 1 | black round bar, 1″ diameter |
| `rod-1x21` | hardware | 21 × 1 × 1 | black round bar, 1″ diameter |
| `bolt-hex-1/4x2` | fastener | ¼″ × 2″ hex bolt | head, washers, nut |
| `bolt-hex-1/4x3` | fastener | ¼″ × 3″ hex bolt | head, washers, nut |
| `bolt-hex-1/4x4` | fastener | ¼″ × 4″ hex bolt | head, washers, nut |
| `bolt-hex-3/8x3` | fastener | ⅜″ × 3″ hex bolt | head, washers, nut |
| `bolt-hex-3/8x4` | fastener | ⅜″ × 4″ hex bolt | head, washers, nut |
| `bolt-hex-3/8x6` | fastener | ⅜″ × 6″ hex bolt | head, washers, nut |
| `bolt-hex-1/2x4` | fastener | ½″ × 4″ hex bolt | head, washers, nut |
| `bolt-hex-1/2x6` | fastener | ½″ × 6″ hex bolt | head, washers, nut |
| `bolt-hex-1/2x8` | fastener | ½″ × 8″ hex bolt | head, washers, nut |
| `hinge-overlay-35mm` | hardware | 35 mm overlay hinge | not rendered in v1 |
| `drawer-slide-18` | hardware | 18 × 1.5 × 0.5 | 18″ side-mount slide (pair); not rendered in v1 |

Catalog entries have `material` and `color` used by the viewport for lumber, sheet goods, L-brackets, and fastener solids.

L-bracket part axes: origin at the inside corner. Axis 0 is the first flange along +X, axis 1 is the fold along +Z, axis 2 is plate thickness along +Y. The second flange rises along +Y (thin +X) and is the same leg length and the same gauge. Default pose sits the first flange on `LxW@0` with the second flange standing. Planar cuts are not allowed.

Flat L-bracket part axes: origin at the outer corner of a single-plane L between `LxW@0` and `LxW@1` (the XZ plane). Axis 0 is the first leg (+X), axis 1 is the second leg (+Z), axis 2 is plate thickness (+Y). `size` is `[leg, arm width, thickness]`. Planar cuts are not allowed.

T-connector (`connector-t`) part axes: origin at the outside corner of the bed, same convention as an L-bracket. The bed is L×W×T on `LxW@0`. The stem is centered across W, gauge T, and rises the catalog `riser` (3″) along +Y. L and W are the timber fit and are independent of each other; T and `riser` do not follow them. Planar cuts are not allowed.

Saddle (`saddle`) part axes: origin at the outside corner of the seat. The seat is L long and T thick. The clear opening is W, and a flange of gauge T and catalog height `flange` (2″) rises along +Y at each edge of that opening. Widening W does not change flange height or gauge. Planar cuts are not allowed.

Round rod (`rod-1x12`, `rod-1x16`, `rod-1x21`): a 16-side prism along L. The circle of diameter min(W, T) is inscribed in the W×T square, so a 1″ rod’s bounding box stays L×1×1. It takes the same planar cuts as lumber.

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
- Hinges (`hinge-overlay-35mm` by default). Count and spacing are chosen from door height (two hinges below ~40″, three above, four above ~80″), inset from the top and bottom (~3″, more on tall doors). After generation the hinge placements are ordinary component members and can be adjusted in YAML.

```yaml
components:
  - label: Upper door
    procedural: cabinet-door
    params: { width: 15, height: 30, depth: 0.75 }
```

## Rendering

- Left pane: YAML editor (CodeMirror) with a walnut/amber theme and lint markers on diagnostics.
- Right pane: react-three-fiber scene — warm hemisphere + shadowed directional light, 1″ grid with 12″ sections, orbit controls, wood-tone materials with CAD edges.
- Click a member to inspect `id`, stock, finished AABB (L × W × T of the cut solid), whether it is fastened, and the members attached to it. Non-selected members fade so fasteners inside the assembly stay visible; attached fasteners highlight.
- Fasteners render as solids: screws (head + shank), bolts (hex head, washers, shank, and nut), and glue beads. Connection recipes expand into those instances. L-brackets, T-connectors, and saddles render as ordinary metal members.
- Drilled bores, including derived pilot and clearance bores, are cut out of the rendered member. A blind bore has a bottom at `depth`. A through bore is open on the exit face. A mesh that is not one watertight solid keeps a dark marker instead of a cut.
- An explode slider radiates members from the scene center (distance-proportional). Parts resting on the floor slide horizontally; downward motion stops at the floor so nothing sinks through it. Fasteners travel with their members.
- Any member not reachable from the first member of the first component is drawn with red/white hazard stripes.
- A screw whose head is covered by a member it joins (no driver access) keeps the red/white hazard hatch along its shank, including when that member is selected, whichever way the screw points. The parts list and selection card call it out.
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
- Render remaining hardware (hinges, slides) as solids / instances.
- Species / grain materials and joinery annotations.
