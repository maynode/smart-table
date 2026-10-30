import { Prisma } from '@prisma/client';
import { buildSortSql } from './automation-filter.sql';

/** Flatten Prisma.Sql into a readable string for assertions. */
function sqlPreview(sql: Prisma.Sql): string {
  let out = '';
  for (let i = 0; i < sql.strings.length; i += 1) {
    out += sql.strings[i];
    if (i < sql.values.length) {
      const value = sql.values[i];
      if (typeof value === 'object' && value !== null && 'strings' in value) {
        out += sqlPreview(value as Prisma.Sql);
      } else {
        out += `$${JSON.stringify(value)}`;
      }
    }
  }
  return out;
}

describe('buildSortSql', () => {
  const statusField = {
    id: 'fld-status',
    type: 'select',
    options: {
      choices: [
        { id: 'unclaimed', name: '未领' },
        { id: 'claimed', name: '已领' },
      ],
    },
  };

  it('defaults empty sorts to id ASC', () => {
    expect(sqlPreview(buildSortSql())).toContain('ORDER BY id ASC');
  });

  it('value mode uses cell key (and numeric cast for number fields)', () => {
    const text = sqlPreview(
      buildSortSql(
        [{ fieldId: 'fld-qty', direction: 'desc', mode: 'value' }],
        [{ id: 'fld-qty', type: 'number' }],
      ),
    );
    expect(text).toContain('::numeric');
    expect(text).toContain('DESC');
    expect(text).toContain('NULLS LAST');
  });

  it('option mode emits CASE indexes from choices', () => {
    const text = sqlPreview(
      buildSortSql(
        [{ fieldId: 'fld-status', direction: 'asc', mode: 'option' }],
        [statusField],
      ),
    );
    expect(text).toContain('CASE');
    expect(text).toContain('WHEN');
    expect(text).toContain('THEN');
    expect(text).toContain('2147483647');
    expect(text).toContain('ASC');
  });

  it('option mode falls back to cell key when no choices', () => {
    const text = sqlPreview(
      buildSortSql(
        [{ fieldId: 'fld-status', direction: 'asc', mode: 'option' }],
        [{ id: 'fld-status', type: 'select', options: { choices: [] } }],
      ),
    );
    expect(text).not.toContain('2147483647');
    expect(text).toContain('cells->');
  });

  it('natural mode pads digit runs', () => {
    const text = sqlPreview(
      buildSortSql([
        { fieldId: 'fld-name', direction: 'asc', mode: 'natural' },
      ]),
    );
    expect(text).toContain('lpad');
    expect(text).toContain('regexp_matches');
    expect(text).toContain('NULLS LAST');
  });

  it('aiComponent value mode sorts by gridContract.sortKey JSON path', () => {
    const text = sqlPreview(
      buildSortSql(
        [{ fieldId: 'fld-rate', direction: 'desc', mode: 'value' }],
        [
          {
            id: 'fld-rate',
            type: 'aiComponent',
            options: {
              aiComponent: {
                gridContract: {
                  sortKey: { path: 'rating', type: 'number' },
                  filter: { path: 'rating', valueType: 'number' },
                },
              },
            },
          },
        ],
      ),
    );
    expect(text).toContain('cells->');
    expect(text).toContain('::numeric');
    expect(text).toContain('DESC');
  });
});
