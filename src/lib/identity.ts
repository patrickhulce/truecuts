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
    if (!isValidId(item.id)) {
      throw new IdentityError(
        `Invalid id "${item.id}" on "${item.label}". Ids must be lower-kebab-case with a numeric suffix, e.g. leg-1.`,
      );
    }
    if (used.has(item.id)) {
      throw new IdentityError(`Duplicate id "${item.id}"`);
    }
    used.add(item.id);
  }

  const nextIndex = new Map<string, number>();

  return items.map((item) => {
    if (item.id) {
      return item as T & { id: string };
    }
    const slug = kebab(item.label);
    let n = nextIndex.get(slug) ?? 1;
    let id = deriveId(item.label, n);
    while (used.has(id)) {
      n += 1;
      id = deriveId(item.label, n);
    }
    nextIndex.set(slug, n + 1);
    used.add(id);
    return { ...item, id };
  });
}
