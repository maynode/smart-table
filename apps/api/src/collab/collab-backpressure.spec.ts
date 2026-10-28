import { CoalesceThrottle } from './collab-backpressure';

describe('CoalesceThrottle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('flushes latest value and drops intermediate', () => {
    const flushed: Array<{ key: string; value: number }> = [];
    const gate = new CoalesceThrottle<number>(50, (key, value) => {
      flushed.push({ key, value });
    });
    gate.push('u1', 1);
    gate.push('u1', 2);
    gate.push('u1', 3);
    expect(flushed).toHaveLength(0);
    jest.advanceTimersByTime(50);
    expect(flushed).toEqual([{ key: 'u1', value: 3 }]);
    expect(gate.droppedCount).toBe(2);
    gate.clear();
  });

  it('isolates keys', () => {
    const flushed: string[] = [];
    const gate = new CoalesceThrottle<string>(30, (key, value) => {
      flushed.push(`${key}:${value}`);
    });
    gate.push('a', '1');
    gate.push('b', '2');
    jest.advanceTimersByTime(30);
    expect(flushed.sort()).toEqual(['a:1', 'b:2']);
    gate.clear();
  });
});
