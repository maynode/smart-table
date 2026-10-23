/** 注册密码：字母 / 数字 / 指定特殊字符，至少两类；≥8；禁止连续 4 位数字或字母。 */

export const PASSWORD_SPECIAL_CHARS = '_%.@#&' as const;

export const PASSWORD_HINT =
  '至少 8 位；字母、数字、特殊字符（_%.@#&）至少两类；不可连续 4 位数字或字母；区分大小写';

const SPECIAL_SET = new Set(PASSWORD_SPECIAL_CHARS.split(''));

export function validatePassword(password: string): string | null {
  if (typeof password !== 'string') return '密码无效';
  if (password.length < 8) return '密码至少 8 位';
  if (password.length > 128) return '密码过长';

  let hasLetter = false;
  let hasDigit = false;
  let hasSpecial = false;

  for (const ch of password) {
    if (/[a-zA-Z]/.test(ch)) {
      hasLetter = true;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      hasDigit = true;
      continue;
    }
    if (SPECIAL_SET.has(ch)) {
      hasSpecial = true;
      continue;
    }
    return `密码仅允许字母、数字和特殊字符（${PASSWORD_SPECIAL_CHARS}）`;
  }

  const kinds = Number(hasLetter) + Number(hasDigit) + Number(hasSpecial);
  if (kinds < 2) {
    return '密码须包含字母、数字、特殊字符（_%.@#&）中的至少两类';
  }

  if (/\d{4}/.test(password)) {
    return '密码不允许连续 4 位数字';
  }
  if (/[a-zA-Z]{4}/.test(password)) {
    return '密码不允许连续 4 位字母';
  }

  return null;
}
