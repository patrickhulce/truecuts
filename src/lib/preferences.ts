export type Preferences = {
  fineSnap: boolean;
  showContacts: boolean;
  /** Red edges and hazard stripes on members not fastened to the assembly. */
  showUnattached: boolean;
  /** Inches. Bores smaller than this are left out of the 3D mesh. 0 cuts every bore. */
  boreDiameter: number;
};

export const DEFAULT_PREFERENCES: Preferences = {
  fineSnap: false,
  showContacts: true,
  showUnattached: true,
  boreDiameter: 1,
};

export const PREFERENCES_KEY = "truecuts.preferences";

export function readPreferences(raw: string | null): Preferences {
  if (!raw) return { ...DEFAULT_PREFERENCES };
  try {
    const data = JSON.parse(raw) as Partial<Preferences>;
    return {
      fineSnap: data.fineSnap === true,
      showContacts: data.showContacts !== false,
      showUnattached: data.showUnattached !== false,
      boreDiameter: boreDiameterOf(data.boreDiameter),
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function boreDiameterOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return DEFAULT_PREFERENCES.boreDiameter;
  return value;
}

export function writePreferences(preferences: Preferences): string {
  return JSON.stringify(preferences);
}
