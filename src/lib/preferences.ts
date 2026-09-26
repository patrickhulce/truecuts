export type Preferences = {
  fineSnap: boolean;
  showContacts: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = {
  fineSnap: false,
  showContacts: true,
};

export const PREFERENCES_KEY = "truecuts.preferences";

export function readPreferences(raw: string | null): Preferences {
  if (!raw) return { ...DEFAULT_PREFERENCES };
  try {
    const data = JSON.parse(raw) as Partial<Preferences>;
    return {
      fineSnap: data.fineSnap === true,
      showContacts: data.showContacts !== false,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function writePreferences(preferences: Preferences): string {
  return JSON.stringify(preferences);
}
