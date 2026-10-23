import type { FieldType } from 'shared';

/** Compact header / settings glyphs aligned with WeCom field-type cues. */
export function fieldTypeIcon(type: string): string {
  const map: Partial<Record<FieldType, string>> = {
    text: 'A',
    title: '题',
    select: '▾',
    multiSelect: '▦',
    number: '#',
    percent: '%',
    currency: '¥',
    progress: '▮',
    date: '日',
    person: '人',
    image: '图',
    file: '件',
    relation: '关',
    url: '链',
    phone: '电',
    email: '@',
    location: '地',
    checkbox: '☑',
    barcode: '码',
    autoNumber: '№',
    formula: 'ƒ',
    lookup: '引',
    createdBy: '创',
    lastEditedBy: '编',
    createdAt: '时',
    lastEditedAt: '改',
    ai: '✦',
  };
  return map[type as FieldType] ?? '·';
}
