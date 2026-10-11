export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*-\d+$/;

export type Labeled = {
  id?: string;
  label: string;
};

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

/** Lower-kebab-case a human label. Falls back to `item` if nothing remains. */
export function kebab(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "item";
}

export function deriveId(label: string, index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new IdentityError(`Index must be a positive integer, got ${index}`);
  }
  return `${kebab(label)}-${index}`;
}

/**
 * Take one id, recording it in `used`. An explicit id must be valid and free.
 * A missing id is `kebab(label)-N`, skipping numbers already taken.
 */
export function claimId(
  label: string,
  explicit: string | undefined,
  used: Set<string>,
  nextIndex: Map<string, number>,
): string {
  if (explicit !== undefined && explicit !== "") {
    if (!isValidId(explicit)) {
      throw new IdentityError(
        `Invalid id "${explicit}" on "${label}". Ids must be lower-kebab-case with a numeric suffix, e.g. leg-1.`,
      );
    }
    if (used.has(explicit)) throw new IdentityError(`Duplicate id "${explicit}"`);
    used.add(explicit);
    return explicit;
  }
  const slug = kebab(label);
  let n = nextIndex.get(slug) ?? 1;
  let id = deriveId(label, n);
  while (used.has(id)) {
    n += 1;
    id = deriveId(label, n);
  }
  nextIndex.set(slug, n + 1);
  used.add(id);
  return id;
}

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/**
 * Assign stable ids to labeled items.
 *
 * Explicit ids are kept (and must match {@link ID_PATTERN}). Missing ids are
 * derived as `kebab(label)-N` with a per-document, per-slug 1-based index,
 * skipping numbers already taken by explicit ids. Order is document order.
 */
export function assignIds<T extends Labeled>(items: T[]): (T & { id: string })[] {
  const used = new Set<string>();
  for (const item of items) {
    if (item.id === undefined || item.id === "") continue;
    claimId(item.label, item.id, used, new Map());
  }
  const nextIndex = new Map<string, number>();
  return items.map((item) => {
    if (item.id) return { ...item, id: item.id };
    return { ...item, id: claimId(item.label, undefined, used, nextIndex) };
  });
}
