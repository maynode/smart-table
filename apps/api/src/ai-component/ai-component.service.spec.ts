import { BadRequestException } from '@nestjs/common';
import { AiComponentService } from './ai-component.service';

describe('AiComponentService', () => {
  function makeService(opts: Record<string, unknown> = {}) {
    const field = {
      id: 'fld-1',
      sheetId: 'sheet-1',
      name: '评分',
      type: 'aiComponent',
      options: { aiComponent: opts },
      sheet: { id: 'sheet-1', baseId: 'base-1' },
    };
    const prisma = {
      field: {
        findUnique: jest.fn(async () => field),
        findUniqueOrThrow: jest.fn(async () => ({ options: field.options })),
        findMany: jest.fn(async () => [
          { id: 'fld-1', name: '评分', type: 'aiComponent' },
        ]),
        update: jest.fn(async ({ data }: { data: { options: unknown } }) => {
          field.options = data.options as typeof field.options;
          return field;
        }),
      },
    };
    const sheets = {
      assertSheetAccess: jest.fn(async () => undefined),
    };
    const storage = {
      saveUpload: jest.fn(async () => ({
        key: 'uploads/x.png',
        url: '/files/uploads/x.png',
        name: 'x.png',
        mimetype: 'image/png',
        size: 12,
      })),
      readUploadBuffer: jest.fn(async () => ({
        buffer: Buffer.from('abc'),
        mimetype: 'image/png',
        name: 'x.png',
      })),
    };
    const service = new AiComponentService(
      prisma as never,
      sheets as never,
      storage as never,
    );
    return { service, prisma, sheets, storage, field };
  }

  it('rejects publish without gridContract', async () => {
    const { service } = makeService({
      status: 'draft',
      bundle: { html: '<div/>', css: '', js: '' },
    });
    await expect(service.publish('fld-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('publishes when bundle + gridContract are complete', async () => {
    const { service, field } = makeService({
      status: 'draft',
      bundle: { html: '<div id="x"></div>', css: '', js: '' },
      gridContract: {
        sortKey: { path: 'rating', type: 'number' },
        filter: {
          path: 'rating',
          ops: ['eq', 'gte'],
          valueType: 'number',
        },
        exportDisplay: { template: '{{rating}} 星' },
      },
    });
    const result = await service.publish('fld-1', 'user-1');
    expect(result.status).toBe('published');
    expect(result.version).toBe(1);
    expect(
      (field.options as { aiComponent: { status: string } }).aiComponent.status,
    ).toBe('published');
  });

  it('chat accepts attachments without text', async () => {
    const { service } = makeService({ status: 'draft', messages: [] });
    const result = await service.chat('fld-1', 'user-1', '', [
      {
        url: '/files/uploads/x.png',
        name: 'x.png',
        mimetype: 'image/png',
        size: 12,
      },
    ]);
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.messages[0].attachments?.[0].url).toContain('/files/uploads/');
    expect(result.canGenerate).toBe(true);
  });

  it('generate falls back to rating bundle when no LLM', async () => {
    const { service } = makeService({
      status: 'draft',
      messages: [{ role: 'user', content: '做个五星评分' }],
    });
    const result = await service.generate('fld-1', 'user-1');
    expect(result.status).toBe('draft');
    expect(result.gridContract.sortKey.path).toBe('rating');
    expect(result.source).toBe('fallback');
  });

  it('rejects empty chat', async () => {
    const { service } = makeService({ status: 'draft' });
    await expect(service.chat('fld-1', 'user-1', '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
