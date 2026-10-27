export interface QueuedMutationRow {
  clientOpId: string;
  sheetId: string;
  mutation: unknown;
  createdAt: number;
  status: 'pending' | 'flushing' | 'conflict';
}
