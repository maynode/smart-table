import { describe, expect, it } from 'vitest';
import {
  faceFromMainView,
  mainViewForFace,
  parseFaceQuery,
  sidebarSectionVisible,
} from './base-face';

describe('base-face', () => {
  it('maps mainView ↔ face', () => {
    expect(faceFromMainView('grid')).toBe('data');
    expect(faceFromMainView('form-results')).toBe('form');
    expect(faceFromMainView('automation')).toBe('automation');
    expect(mainViewForFace('form', { formMode: 'results' })).toBe(
      'form-results',
    );
    expect(mainViewForFace('data')).toBe('grid');
  });

  it('filters sidebar sections by face', () => {
    expect(sidebarSectionVisible('data', 'sheets')).toBe(true);
    expect(sidebarSectionVisible('data', 'forms')).toBe(false);
    expect(sidebarSectionVisible('form', 'forms')).toBe(true);
    expect(sidebarSectionVisible('form', 'sheets')).toBe(false);
    expect(sidebarSectionVisible('automation', 'sheets')).toBe(false);
    expect(sidebarSectionVisible('dashboard', 'dashboards')).toBe(true);
  });

  it('parses face query', () => {
    expect(parseFaceQuery({ face: 'form', oid: 'f1', formMode: 'results' })).toEqual(
      {
        face: 'form',
        oid: 'f1',
        formMode: 'results',
      },
    );
    expect(parseFaceQuery({ face: 'nope' }).face).toBeNull();
  });
});
