/**
 * Unified offline action gate: allow | queue | block.
 * Surfaces that cannot work offline must block — never silent degrade.
 */

export type OfflineDecision = 'allow' | 'queue' | 'block';

export type OfflineAction =
  | 'grid.browse'
  | 'grid.editCell'
  | 'grid.createRecord'
  | 'grid.deleteRecord'
  | 'grid.fieldMeta'
  | 'hub.browse'
  | 'hub.mutate'
  | 'form.browse'
  | 'form.submit'
  | 'form.design'
  | 'dashboard.browse'
  | 'dashboard.layout'
  | 'dashboard.ai'
  | 'analysis.browse'
  | 'analysis.generate'
  | 'automation.browse'
  | 'automation.edit'
  | 'automation.run'
  | 'acl.write'
  | 'share.admin'
  | 'export'
  | 'auth'
  | 'upload.immediate';

const TABLE: Record<OfflineAction, OfflineDecision> = {
  'grid.browse': 'allow',
  'grid.editCell': 'queue',
  'grid.createRecord': 'queue',
  'grid.deleteRecord': 'queue',
  'grid.fieldMeta': 'queue',
  'hub.browse': 'allow',
  'hub.mutate': 'queue',
  'form.browse': 'allow',
  'form.submit': 'queue',
  'form.design': 'queue',
  'dashboard.browse': 'allow',
  'dashboard.layout': 'queue',
  'dashboard.ai': 'block',
  'analysis.browse': 'allow',
  'analysis.generate': 'block',
  'automation.browse': 'allow',
  'automation.edit': 'queue',
  'automation.run': 'block',
  'acl.write': 'block',
  'share.admin': 'block',
  export: 'block',
  auth: 'block',
  'upload.immediate': 'block',
};

export function offlineDecision(action: OfflineAction): OfflineDecision {
  if (typeof navigator === 'undefined' || navigator.onLine) return 'allow';
  return TABLE[action];
}

export function offlineBlockMessage(action: OfflineAction): string {
  switch (action) {
    case 'dashboard.ai':
    case 'analysis.generate':
      return '离线无法使用 AI，请联网后重试';
    case 'automation.run':
      return '离线无法运行自动化，请联网后重试';
    case 'acl.write':
    case 'share.admin':
      return '离线无法修改权限或分享设置';
    case 'export':
      return '离线无法导出';
    case 'auth':
      return '需要联网才能登录';
    case 'upload.immediate':
      return '离线请使用可入队的附件上传';
    default:
      return '当前离线，该操作不可用';
  }
}
