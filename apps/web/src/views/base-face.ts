export type BaseFace =
  | 'data'
  | 'form'
  | 'automation'
  | 'dashboard'
  | 'analysis';

export type MainView =
  | 'grid'
  | 'form'
  | 'form-results'
  | 'dashboard'
  | 'analysis'
  | 'automation';

export function faceFromMainView(view: MainView): BaseFace {
  if (view === 'form' || view === 'form-results') return 'form';
  if (view === 'dashboard') return 'dashboard';
  if (view === 'analysis') return 'analysis';
  if (view === 'automation') return 'automation';
  return 'data';
}

export function mainViewForFace(
  face: BaseFace,
  opts?: { formMode?: 'design' | 'results' },
): MainView {
  if (face === 'form') {
    return opts?.formMode === 'results' ? 'form-results' : 'form';
  }
  if (face === 'dashboard') return 'dashboard';
  if (face === 'analysis') return 'analysis';
  if (face === 'automation') return 'automation';
  return 'grid';
}

/** Sidebar section visibility under face-first IA (spec D6). */
export function sidebarSectionVisible(
  face: BaseFace,
  section: 'sheets' | 'forms' | 'dashboards' | 'analysis' | 'create',
): boolean {
  if (section === 'create') return true;
  if (face === 'data') return section === 'sheets';
  if (face === 'form') return section === 'forms';
  if (face === 'dashboard') return section === 'dashboards';
  if (face === 'analysis') return section === 'analysis';
  // automation: no object tree sections (panel owns list)
  return false;
}

export type FaceQuery = {
  face?: string;
  oid?: string;
  formMode?: string;
};

export function parseFaceQuery(q: FaceQuery): {
  face: BaseFace | null;
  oid: string | null;
  formMode: 'design' | 'results' | null;
} {
  const raw = q.face;
  const face: BaseFace | null =
    raw === 'data' ||
    raw === 'form' ||
    raw === 'automation' ||
    raw === 'dashboard' ||
    raw === 'analysis'
      ? raw
      : null;
  const formMode =
    q.formMode === 'results'
      ? 'results'
      : q.formMode === 'design'
        ? 'design'
        : null;
  const oid = typeof q.oid === 'string' && q.oid ? q.oid : null;
  return { face, oid, formMode };
}
