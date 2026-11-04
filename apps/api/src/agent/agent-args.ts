import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';

export function strArg(
  args: Record<string, unknown>,
  key: string,
  opts?: { required?: boolean; defaultValue?: string },
): string {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === '') {
    if (opts?.required) {
      throw new BadRequestException(`缺少参数: ${key}`);
    }
    return opts?.defaultValue ?? '';
  }
  if (typeof raw !== 'string') {
    throw new BadRequestException(`参数 ${key} 须为字符串`);
  }
  return raw;
}

export function numArg(
  args: Record<string, unknown>,
  key: string,
  opts?: { required?: boolean; defaultValue?: number; min?: number; max?: number },
): number {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === '') {
    if (opts?.required) {
      throw new BadRequestException(`缺少参数: ${key}`);
    }
    return opts?.defaultValue ?? 0;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    throw new BadRequestException(`参数 ${key} 须为数字`);
  }
  if (opts?.min !== undefined && n < opts.min) {
    throw new BadRequestException(`参数 ${key} 不能小于 ${opts.min}`);
  }
  if (opts?.max !== undefined && n > opts.max) {
    throw new BadRequestException(`参数 ${key} 不能大于 ${opts.max}`);
  }
  return n;
}

export function objArg(
  args: Record<string, unknown>,
  key: string,
  opts?: { required?: boolean },
): Record<string, unknown> {
  const raw = args[key];
  if (raw === undefined || raw === null) {
    if (opts?.required) {
      throw new BadRequestException(`缺少参数: ${key}`);
    }
    return {};
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException(`参数 ${key} 须为对象`);
  }
  return raw as Record<string, unknown>;
}

export function arrArg(
  args: Record<string, unknown>,
  key: string,
  opts?: { required?: boolean },
): unknown[] {
  const raw = args[key];
  if (raw === undefined || raw === null) {
    if (opts?.required) {
      throw new BadRequestException(`缺少参数: ${key}`);
    }
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new BadRequestException(`参数 ${key} 须为数组`);
  }
  return raw;
}

export function newClientOpId(prefix = 'agt'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function ok(data: unknown) {
  return { ok: true as const, data };
}

export function fail(error: unknown, code = 'TOOL_ERROR') {
  const message =
    error instanceof Error ? error.message : String(error ?? 'failed');
  return { ok: false as const, error: message, code };
}
