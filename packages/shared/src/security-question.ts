/** 密保问题预设；也可自定义。 */

export const SECURITY_QUESTION_PRESETS = [
  '你最喜欢的食物是什么？',
  '你小学就读的学校名称是？',
  '你出生的城市是哪里？',
  '你第一次旅游去的城市是？',
  '你的幸运数字是多少？',
] as const;

export const SECURITY_ANSWER_HINT = '请牢记答案，找回密码时需要用到';

export function normalizeSecurityAnswer(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '');
}

export function validateSecurityQuestion(raw: string): string | null {
  if (typeof raw !== 'string') return '请选择或填写密保问题';
  const q = raw.trim();
  if (q.length < 2) return '密保问题过短';
  if (q.length > 100) return '密保问题过长';
  return null;
}

export function validateSecurityAnswer(raw: string): string | null {
  if (typeof raw !== 'string') return '请填写密保答案';
  const a = raw.trim();
  if (a.length < 1) return '请填写密保答案';
  if (a.length > 64) return '密保答案过长';
  return null;
}
