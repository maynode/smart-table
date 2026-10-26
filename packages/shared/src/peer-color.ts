/**
 * 协同光标/头像颜色：由 userId 稳定哈希到色相。
 * 不设 12 色上限，万人同表也不会「颜色用完」；同用户始终同色。
 */
export function peerColorFromUserId(userId: string): string {
  const id = (userId || '').trim() || 'anon';
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hue = (hash >>> 0) % 360;
  // 固定饱和度/亮度，保证浅底上可读、彼此可区分
  return `hsl(${hue} 72% 46%)`;
}
