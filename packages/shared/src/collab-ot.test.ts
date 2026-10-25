import {
  transformAgainstPeers,
  transformMutationAgainst,
} from './collab-ot';
import type { SheetMutation } from './offline-mutations';

const set = (
  recordId: string,
  cells: Record<string, unknown>,
  clientOpId = 'a',
): SheetMutation => ({
  type: 'setRecord',
  clientOpId,
  recordId,
  cells,
});

describe('collab OT', () => {
  it('keeps setRecord on different records', () => {
    const out = transformMutationAgainst(
      set('r1', { f1: 'x' }),
      set('r2', { f1: 'y' }, 'b'),
    );
    expect(out.kind).toBe('keep');
  });

  it('drops overlapping cells when peer already won same cell', () => {
    const out = transformMutationAgainst(
      set('r1', { f1: 'local', f2: 'keep' }),
      set('r1', { f1: 'peer' }, 'b'),
    );
    expect(out.kind).toBe('keep');
    if (out.kind === 'keep' && out.mutation.type === 'setRecord') {
      expect(out.mutation.cells).toEqual({ f2: 'keep' });
    }
  });

  it('drops setRecord when peer deleted the record', () => {
    const out = transformMutationAgainst(set('r1', { f1: 'x' }), {
      type: 'deleteRecord',
      clientOpId: 'b',
      recordId: 'r1',
    });
    expect(out.kind).toBe('drop');
  });

  it('strips deleted field from setRecord', () => {
    const out = transformMutationAgainst(set('r1', { f1: 'x', f2: 'y' }), {
      type: 'deleteField',
      clientOpId: 'b',
      fieldId: 'f1',
    });
    expect(out.kind).toBe('keep');
    if (out.kind === 'keep' && out.mutation.type === 'setRecord') {
      expect(out.mutation.cells).toEqual({ f2: 'y' });
    }
  });

  it('transformAgainstPeers applies sequence', () => {
    const out = transformAgainstPeers(set('r1', { f1: 'a', f2: 'b' }), [
      set('r1', { f1: 'p' }, 'p1'),
      {
        type: 'deleteField',
        clientOpId: 'p2',
        fieldId: 'f2',
      },
    ]);
    expect(out.kind).toBe('drop');
  });
});
