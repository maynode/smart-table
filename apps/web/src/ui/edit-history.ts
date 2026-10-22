export interface EditHistoryEntry {
  id: string;
  at: number;
  sheetId: string;
  recordId: string;
  fieldId: string;
  fieldName: string;
  previous: unknown;
  next: unknown;
  label: string;
}

const MAX = 100;

const undoStack: EditHistoryEntry[] = [];
const redoStack: EditHistoryEntry[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeEditHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUndoStack(): readonly EditHistoryEntry[] {
  return undoStack;
}

export function getRedoStack(): readonly EditHistoryEntry[] {
  return redoStack;
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function pushEdit(entry: Omit<EditHistoryEntry, 'id' | 'at'>): void {
  undoStack.push({
    ...entry,
    id: crypto.randomUUID(),
    at: Date.now(),
  });
  if (undoStack.length > MAX) undoStack.shift();
  redoStack.length = 0;
  notify();
}

/** Peek+pop undo without touching redo (caller pushes to redo on success). */
export function takeUndo(): EditHistoryEntry | null {
  const entry = undoStack.pop() ?? null;
  if (entry) notify();
  return entry;
}

export function takeRedo(): EditHistoryEntry | null {
  const entry = redoStack.pop() ?? null;
  if (entry) notify();
  return entry;
}

export function pushRedo(entry: EditHistoryEntry): void {
  redoStack.push(entry);
  notify();
}

export function pushUndoEntry(entry: EditHistoryEntry): void {
  undoStack.push(entry);
  notify();
}

export function clearEditHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
  notify();
}
