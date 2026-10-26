/** 可推给公开视图 / 公开填表连接的 Live kind（与 LiveRoomService 一致） */
export function isPublicSafeLiveKind(kind: string): boolean {
  return (
    kind.startsWith('public_view.') ||
    kind === 'sheet.rev_bumped' ||
    kind === 'sheet.schema_changed' ||
    kind === 'form.updated' ||
    kind === 'form.published' ||
    kind === 'form.deleted' ||
    kind === 'dashboard.updated' ||
    kind === 'dashboard.deleted' ||
    kind === 'widget.changed' ||
    kind === 'analysis.updated' ||
    kind === 'analysis.deleted'
  );
}
