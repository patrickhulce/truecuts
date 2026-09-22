<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Conventions

- Parts keep their **trade names** (a 2×4 is still called a 2×4). Every **numeric** dimension is **L×W×T**, longest → shortest. A 2×4×8 is `[96, 3.5, 1.5]` = 8′ × 3.5″ × 1.5″.
- Cut axes index that tuple: **0 = L**, **1 = W**, **2 = T**.
- Default local frame: **X = L**, **Z = W**, **Y = T** (world is right-handed, Y-up). Default placement sits `LxW@0` on the ground, thickness along +Y.
- A part face is the two spanning axes (earlier dimension first: L, then W, then T) plus `@0` or `@1`. `@0` is the plane through the origin; `@1` is the plane at the stock extent of the other axis. `LxW@0` / `LxW@1` are the wide faces (normal −Y / +Y), `LxT@0` / `LxT@1` the edges (normal −Z / +Z), `WxT@0` / `WxT@1` the ends (normal −X / +X). A crosscut does not move these planes; the cut cap is not a face id.
