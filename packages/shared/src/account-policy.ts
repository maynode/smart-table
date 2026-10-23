import { PASSWORD_SPECIAL_CHARS } from './password-policy';

/** 登录账号：字母 / 数字 / 与密码相同的特殊字符，4–12 位，不区分大小写（存小写）。 */

export const ACCOUNT_MIN_LENGTH = 4;
export const ACCOUNT_MAX_LENGTH = 12;
export const ACCOUNT_SPECIAL_CHARS = PASSWORD_SPECIAL_CHARS;

export const ACCOUNT_HINT = `${ACCOUNT_MIN_LENGTH}–${ACCOUNT_MAX_LENGTH} 位；字母、数字、特殊字符（${ACCOUNT_SPECIAL_CHARS}）；不区分大小写`;

/** 字符类内需转义的符号。 */
function escapeCharClass(chars: string): string {
  return chars.replace(/[\\^\]]/g, '\\$&').replace(/-/g, '\\-');
}

const ACCOUNT_RE = new RegExp(
  `^[a-zA-Z0-9${escapeCharClass(ACCOUNT_SPECIAL_CHARS)}]{${ACCOUNT_MIN_LENGTH},${ACCOUNT_MAX_LENGTH}}$`,
);

export function normalizeAccount(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 通过返回 null，失败返回中文原因。 */
export function validateAccount(raw: string): string | null {
  if (typeof raw !== 'string') return '账号无效';
  const account = raw.trim();
  if (account.length < ACCOUNT_MIN_LENGTH) {
    return `账号至少 ${ACCOUNT_MIN_LENGTH} 位`;
  }
  if (account.length > ACCOUNT_MAX_LENGTH) {
    return `账号最多 ${ACCOUNT_MAX_LENGTH} 位`;
  }
  if (!ACCOUNT_RE.test(account)) {
    return `账号仅允许字母、数字和特殊字符（${ACCOUNT_SPECIAL_CHARS}）`;
  }
  return null;
}
