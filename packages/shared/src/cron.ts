/**
 * Small five-field cron parser used by the automation scheduler.
 *
 * Supported syntax per field: `*`, values, lists (`1,3,5`), ranges (`1-5`),
 * and steps (every 15 minutes, `1-30/5`). Both day-of-month and day-of-week restricted
 * follows Vixie cron: the date matches when EITHER day field matches.
 */

export interface CronDateParts {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
}

export interface NextCronOptions {
  from?: Date;
  /** IANA timezone, e.g. Asia/Shanghai. Defaults to the server local zone. */
  timezone?: string;
  /** Search horizon; defaults to 366 days. */
  maxMinutes?: number;
}

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

const FIELD_ALIASES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export class InvalidCronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCronError';
  }
}

function normalizeValue(
  raw: string | number,
  min: number,
  max: number,
): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new InvalidCronError(`cron 值超出范围: ${raw}`);
  }
  return value;
}

function parseField(
  raw: string,
  index: number,
): { values: Set<number>; wildcard: boolean } {
  const [min, max] = FIELD_RANGES[index];
  const values = new Set<number>();
  const text = raw.trim().toLowerCase();
  if (!text) throw new InvalidCronError('cron 字段为空');
  const wildcard = text === '*' || text.startsWith('*/');

  for (const piece of text.split(',')) {
    if (!piece) throw new InvalidCronError(`cron 字段无效: ${raw}`);
    const [rangePart, stepPart] = piece.split('/');
    if (piece.split('/').length > 2) {
      throw new InvalidCronError(`cron 步长无效: ${piece}`);
    }
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw new InvalidCronError(`cron 步长无效: ${piece}`);
    }

    let start: number;
    let end: number;
    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [left, right] = rangePart.split('-');
      start = normalizeValue(
        FIELD_ALIASES[left] ?? left,
        min,
        // Sunday may be written as 7
        index === 4 ? 7 : max,
      );
      end = normalizeValue(
        FIELD_ALIASES[right] ?? right,
        min,
        index === 4 ? 7 : max,
      );
      if (start > end) {
        throw new InvalidCronError(`cron 范围无效: ${piece}`);
      }
    } else {
      start = normalizeValue(
        FIELD_ALIASES[rangePart] ?? rangePart,
        min,
        index === 4 ? 7 : max,
      );
      // A bare value with a step means "start/step"; match up to max.
      end = stepPart === undefined ? start : max;
    }

    for (let value = start; value <= end; value += step) {
      values.add(index === 4 && value === 7 ? 0 : value);
    }
  }

  if (values.size === 0) {
    throw new InvalidCronError(`cron 字段无有效值: ${raw}`);
  }
  return { values, wildcard };
}

export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domWildcard: boolean;
  dowWildcard: boolean;
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new InvalidCronError('cron 必须是 5 个字段');
  }
  const minute = parseField(parts[0], 0);
  const hour = parseField(parts[1], 1);
  const dom = parseField(parts[2], 2);
  const month = parseField(parts[3], 3);
  const dow = parseField(parts[4], 4);
  return {
    minutes: minute.values,
    hours: hour.values,
    daysOfMonth: dom.values,
    months: month.values,
    daysOfWeek: dow.values,
    domWildcard: dom.wildcard,
    dowWildcard: dow.wildcard,
  };
}

export function validateCron(expression: string): void {
  parseCron(expression);
}

export function datePartsInZone(
  date: Date,
  timezone?: string,
): CronDateParts {
  if (!timezone) {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      day: date.getDate(),
      month: date.getMonth() + 1,
      weekday: date.getDay(),
    };
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    minute: Number(values.minute),
    hour: Number(values.hour),
    day: Number(values.day),
    month: Number(values.month),
    weekday: weekdays[values.weekday] ?? 0,
  };
}

function domMatches(parsed: ParsedCron, day: number): boolean {
  return parsed.daysOfMonth.has(day);
}

function dowMatches(parsed: ParsedCron, weekday: number): boolean {
  return parsed.daysOfWeek.has(weekday);
}

export function cronMatches(
  parsed: ParsedCron,
  parts: CronDateParts,
): boolean {
  if (!parsed.minutes.has(parts.minute)) return false;
  if (!parsed.hours.has(parts.hour)) return false;
  if (!parsed.months.has(parts.month)) return false;

  let dayMatches: boolean;
  if (parsed.domWildcard && parsed.dowWildcard) {
    dayMatches = true;
  } else if (parsed.domWildcard) {
    dayMatches = dowMatches(parsed, parts.weekday);
  } else if (parsed.dowWildcard) {
    dayMatches = domMatches(parsed, parts.day);
  } else {
    dayMatches =
      domMatches(parsed, parts.day) || dowMatches(parsed, parts.weekday);
  }
  return dayMatches;
}

/** Returns the next matching instant strictly after `from` (minute precision). */
export function nextCronDate(
  expression: string,
  options: NextCronOptions = {},
): Date {
  const parsed = parseCron(expression);
  const from = options.from ?? new Date();
  const maxMinutes = options.maxMinutes ?? 366 * 24 * 60;
  // Start with the next whole minute.
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < maxMinutes; i += 1) {
    const parts = datePartsInZone(candidate, options.timezone);
    if (cronMatches(parsed, parts)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  throw new InvalidCronError('cron 在未来一年内没有匹配时间');
}

/** Human-readable next-run preview for the automation editor. */
export function nextCronPreview(
  expression: string,
  timezone?: string,
  count = 3,
): string[] {
  const previews: string[] = [];
  let cursor = new Date();
  for (let i = 0; i < count; i += 1) {
    cursor = nextCronDate(expression, { from: cursor, timezone });
    previews.push(
      new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone,
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(cursor),
    );
  }
  return previews;
}
