export const HISTORY_LIMIT = 100;

export type HistoryState = {
  entries: string[];
  cursor: number;
};

export function emptyHistory(): HistoryState {
  return { entries: [], cursor: -1 };
}

export function currentYaml(state: HistoryState): string | undefined {
  if (state.cursor < 0 || state.cursor >= state.entries.length) return undefined;
  return state.entries[state.cursor];
}

export function canUndo(state: HistoryState): boolean {
  return state.cursor > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.cursor >= 0 && state.cursor < state.entries.length - 1;
}

export function pushHistory(state: HistoryState, yaml: string, max = HISTORY_LIMIT): HistoryState {
  if (state.entries[state.cursor] === yaml) return state;
  const entries = [...state.entries.slice(0, state.cursor + 1), yaml];
  if (entries.length <= max) {
    return { entries, cursor: entries.length - 1 };
  }
  const overflow = entries.length - max;
  return { entries: entries.slice(overflow), cursor: max - 1 };
}

export function undoHistory(state: HistoryState): HistoryState | undefined {
  if (!canUndo(state)) return undefined;
  return { entries: state.entries, cursor: state.cursor - 1 };
}

export function redoHistory(state: HistoryState): HistoryState | undefined {
  if (!canRedo(state)) return undefined;
  return { entries: state.entries, cursor: state.cursor + 1 };
}
