/**
 * 登录用户名：2–20 个字符；不可含空白 / 控制符 / 零宽字符；全局唯一。
 * 字母不区分大小写（规范化为小写存储）；支持中文等可见字符。
 */

export const ACCOUNT_MIN_LENGTH = 2;
export const ACCOUNT_MAX_LENGTH = 20;

/** @deprecated 用户名已不再限制为密码特殊字符集；保留导出以免旧引用报错。 */
export const ACCOUNT_SPECIAL_CHARS = '' as const;

export const ACCOUNT_HINT = `${ACCOUNT_MIN_LENGTH}–${ACCOUNT_MAX_LENGTH} 个字符；不可含空格；支持中文；不可与他人重复；字母不区分大小写`;

export const ACCOUNT_TAKEN_MESSAGE = '该用户名已被注册';

/** 按 Unicode 码点计数（中文/emoji 更接近「看见的字数」）。 */
export function accountLength(value: string): number {
  return Array.from(value).length;
}

function hasForbiddenChar(value: string): boolean {
  for (const ch of value) {
    if (/\s/u.test(ch)) return true;
    if (/\p{Cc}/u.test(ch)) return true;
    if (/\p{Cf}/u.test(ch)) return true;
  }
  return false;
}

/** 规范化：去首尾空白、NFC、小写（用于存储与唯一匹配）。 */
export function normalizeAccount(raw: string): string {
  return raw.trim().normalize('NFC').toLowerCase();
}

/** 通过返回 null，失败返回中文原因。 */
export function validateAccount(raw: string): string | null {
  if (typeof raw !== 'string') return '用户名无效';
  const account = raw.trim().normalize('NFC');
  const len = accountLength(account);
  if (len < ACCOUNT_MIN_LENGTH) {
    return `用户名至少 ${ACCOUNT_MIN_LENGTH} 个字符`;
  }
  if (len > ACCOUNT_MAX_LENGTH) {
    return `用户名最多 ${ACCOUNT_MAX_LENGTH} 个字符`;
  }
  if (hasForbiddenChar(account)) {
    return '用户名不能包含空格或不可见字符';
  }
  return null;
}
