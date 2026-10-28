import { ConfigService } from '@nestjs/config';
import { CollabFanoutService } from './collab-fanout.service';
import type { CollabServerMsg } from './collab.types';

describe('CollabFanoutService', () => {
  it('ignores redis envelopes from the same origin and delivers others', () => {
    const svc = new CollabFanoutService(
      new ConfigService({ COLLAB_REDIS: '0', REDIS_URL: 'off' }),
    );
    const delivered: Array<{ sheetId: string; msg: CollabServerMsg }> = [];
    svc.setLocalHandler((sheetId, msg) => {
      delivered.push({ sheetId, msg });
    });

    const msg: CollabServerMsg = {
      type: 'comm_notice',
      noticeType: 'DIRTY_AREA_CHANGE',
      sheetRev: 3,
    };
    const origin = (svc as unknown as { originId: string }).originId;
    const onRedis = (
      svc as unknown as { onRedisMessage: (p: string) => void }
    ).onRedisMessage.bind(svc);

    onRedis(
      JSON.stringify({ origin, sheetId: 's1', msg }),
    );
    expect(delivered).toHaveLength(0);

    onRedis(
      JSON.stringify({ origin: 'other-pod', sheetId: 's1', msg }),
    );
    expect(delivered).toEqual([{ sheetId: 's1', msg }]);
  });
});
