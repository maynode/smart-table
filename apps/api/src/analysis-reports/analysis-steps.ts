export type AnalysisStepId =
  | 'understand'
  | 'ask'
  | 'explore'
  | 'metrics'
  | 'generate'
  | 'deliver';

export type AnalysisStepStatus = 'pending' | 'active' | 'done';

export interface AnalysisStep {
  id: AnalysisStepId;
  label: string;
  status: AnalysisStepStatus;
}

export interface AnalysisMessageOption {
  id: string;
  label: string;
}

export interface AnalysisMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  kind?: 'text' | 'choice';
  options?: AnalysisMessageOption[];
  createdAt: string;
}

export const DEFAULT_STEPS: AnalysisStep[] = [
  { id: 'understand', label: '理解分析要求', status: 'pending' },
  { id: 'ask', label: '询问用户问题', status: 'pending' },
  { id: 'explore', label: '探索表格数据', status: 'pending' },
  { id: 'metrics', label: '梳理字段和计算口径', status: 'pending' },
  { id: 'generate', label: '生成报告内容', status: 'pending' },
  { id: 'deliver', label: '交付分析报告', status: 'pending' },
];

const STEP_ORDER = DEFAULT_STEPS.map((s) => s.id);

export function markSteps(activeId: AnalysisStepId): AnalysisStep[] {
  const activeIdx = STEP_ORDER.indexOf(activeId);
  return DEFAULT_STEPS.map((step, idx) => {
    if (idx < activeIdx) return { ...step, status: 'done' as const };
    if (idx === activeIdx) return { ...step, status: 'active' as const };
    return { ...step, status: 'pending' as const };
  });
}

export function markAllDone(): AnalysisStep[] {
  return DEFAULT_STEPS.map((step) => ({ ...step, status: 'done' as const }));
}

export function newMessageId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
