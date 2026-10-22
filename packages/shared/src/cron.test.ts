import {
  InvalidCronError,
  cronMatches,
  datePartsInZone,
  nextCronDate,
  parseCron,
  validateCron,
} from './cron';

describe('cron', () => {
  it('validates five fields and rejects malformed expressions', () => {
    expect(() => validateCron('* * * * *')).not.toThrow();
    expect(() => validateCron('*/15 9-18 * * 1-5')).not.toThrow();
    expect(() => validateCron('* * *')).toThrow(InvalidCronError);
    expect(() => validateCron('61 * * * *')).toThrow(InvalidCronError);
  });

  it('matches steps, ranges and Sunday alias 7', () => {
    const parsed = parseCron('*/15 9-10 * * 1-5');
    expect(
      cronMatches(parsed, {
        minute: 30,
        hour: 9,
        day: 12,
        month: 10,
        weekday: 3,
      }),
    ).toBe(true);
    expect(
      cronMatches(parsed, {
        minute: 31,
        hour: 9,
        day: 12,
        month: 10,
        weekday: 3,
      }),
    ).toBe(false);
    const sunday = parseCron('0 9 * * 7');
    expect(
      cronMatches(sunday, {
        minute: 0,
        hour: 9,
        day: 12,
        month: 10,
        weekday: 0,
      }),
    ).toBe(true);
  });

  it('follows Vixie OR semantics when DOM and DOW are both restricted', () => {
    const parsed = parseCron('0 9 1 * 1');
    // Oct 1 2026 is a Thursday: DOM matches.
    expect(
      cronMatches(parsed, {
        minute: 0,
        hour: 9,
        day: 1,
        month: 10,
        weekday: 4,
      }),
    ).toBe(true);
    // Oct 5 2026 is a Monday: DOW matches.
    expect(
      cronMatches(parsed, {
        minute: 0,
        hour: 9,
        day: 5,
        month: 10,
        weekday: 1,
      }),
    ).toBe(true);
    expect(
      cronMatches(parsed, {
        minute: 0,
        hour: 9,
        day: 6,
        month: 10,
        weekday: 2,
      }),
    ).toBe(false);
  });

  it('computes the next UTC minute and honours timezones', () => {
    const from = new Date('2026-10-22T01:00:30Z');
    const next = nextCronDate('*/5 * * * *', { from, timezone: 'UTC' });
    expect(next.toISOString()).toBe('2026-10-22T01:05:00.000Z');

    const shanghai = nextCronDate('0 9 * * *', {
      from,
      timezone: 'Asia/Shanghai',
    });
    expect(shanghai.toISOString()).toBe('2026-10-23T01:00:00.000Z');
    expect(datePartsInZone(shanghai, 'Asia/Shanghai')).toMatchObject({
      hour: 9,
      minute: 0,
    });
  });
});
