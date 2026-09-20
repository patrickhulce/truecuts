<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Conventions

- Parts keep their **trade names** (a 2×4 is still called a 2×4). Every **numeric** dimension is **L×W×T**, longest → shortest. A 2×4×8 is `[96, 3.5, 1.5]` = 8′ × 3.5″ × 1.5″.
- Cut axes index that tuple: **0 = L**, **1 = W**, **2 = T**.
- Default local frame: **X = L**, **Z = W**, **Y = T** (world is right-handed, Y-up). Default placement sits the L×W face on the ground, thickness along +Y.
- Faces are named by the dimensions that span them: **L×W** (wide face, normal ±Y), **L×T** (edge, normal ±Z), **W×T** (end, normal ±X).
