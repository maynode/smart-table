import { Prisma, type PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { randomBytes, randomUUID } from 'node:crypto';

const DEMO_ACCOUNT = 'demo';
const DEMO_PASSWORD = 'Passw0rd!123';
const WORKSPACE_NAME = '序列号领取演示';
const BASE_NAME = '序列号领取';
const CODE_COUNT = 100;

export interface SerialClaimSeedResult {
  created: boolean;
  workspaceId: string;
  baseId: string;
  formId: string;
  shareToken: string;
  shareUrl: string;
  automationId: string;
  demoAccount: string;
  demoPassword: string;
  codes: number;
}

/**
 * Task 11 seed: Base「序列号领取」with 码库/收集表单, the "联动修改" automation,
 * a success-page template, and demo codes. Idempotent: returns the existing
 * base when it already exists instead of creating duplicates.
 */
export async function seedSerialClaim(
  prisma: PrismaClient,
): Promise<SerialClaimSeedResult> {
  const publicBase = (
    process.env.PUBLIC_FORM_BASE_URL ?? 'http://localhost:5173'
  ).replace(/\/$/, '');

  let user = await prisma.user.findUnique({ where: { account: DEMO_ACCOUNT } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        account: DEMO_ACCOUNT,
        name: '演示管理员',
        passwordHash: await hash(DEMO_PASSWORD),
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswerHash: await hash('demo'),
      },
    });
  }

  let workspace = await prisma.workspace.findFirst({
    where: { name: WORKSPACE_NAME },
  });
  if (!workspace) {
    workspace = await prisma.workspace.create({ data: { name: WORKSPACE_NAME } });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: 'owner' },
    });
  } else {
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
      },
    });
    if (!membership) {
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: user.id, role: 'owner' },
      });
    }
  }

  const existingBase = await prisma.base.findFirst({
    where: { workspaceId: workspace.id, name: BASE_NAME },
  });
  if (existingBase) {
    const form = await prisma.form.findFirst({
      where: { baseId: existingBase.id },
    });
    if (form) {
      const automation = await prisma.automation.findFirst({
        where: { baseId: existingBase.id },
      });
      return {
        created: false,
        workspaceId: workspace.id,
        baseId: existingBase.id,
        formId: form.id,
        shareToken: form.shareToken,
        shareUrl: `${publicBase}/fill/${form.shareToken}`,
        automationId: automation?.id ?? '',
        demoAccount: DEMO_ACCOUNT,
        demoPassword: DEMO_PASSWORD,
        codes: await prisma.recordRow.count({
          where: { sheet: { baseId: existingBase.id, name: '码库' } },
        }),
      };
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const base =
      existingBase ??
      (await tx.base.create({
        data: { workspaceId: workspace!.id, name: BASE_NAME },
      }));

    const formSheet = await tx.sheet.create({
      data: { baseId: base.id, name: '收集表单' },
    });
    const codeSheet = await tx.sheet.create({
      data: { baseId: base.id, name: '码库' },
    });

    // 对齐企微：收集表单默认仅手机号
    const phone = await tx.field.create({
      data: {
        sheetId: formSheet.id,
        name: '手机号',
        type: 'phone',
        order: 0,
        required: true,
      },
    });

    const serial = await tx.field.create({
      data: { sheetId: codeSheet.id, name: '序列号', type: 'text', order: 0 },
    });
    const status = await tx.field.create({
      data: {
        sheetId: codeSheet.id,
        name: '状态',
        type: 'select',
        order: 1,
        options: {
          choices: [
            { id: 'unclaimed', name: '未领', color: 'gray' },
            { id: 'claimed', name: '已领', color: 'green' },
          ],
        },
      },
    });
    const claimedPhone = await tx.field.create({
      data: {
        sheetId: codeSheet.id,
        name: '领取手机号',
        type: 'phone',
        order: 2,
      },
    });
    const claimedAt = await tx.field.create({
      data: { sheetId: codeSheet.id, name: '领取时间', type: 'date', order: 3 },
    });

    for (let index = 1; index <= CODE_COUNT; index += 1) {
      await tx.recordRow.create({
        data: {
          sheetId: codeSheet.id,
          claimStatus: 'unclaimed',
          cells: {
            [serial.id]: `DEMO-${String(index).padStart(4, '0')}`,
            [status.id]: 'unclaimed',
          },
        },
      });
    }

    const formId = randomUUID();
    const shareToken = randomBytes(12).toString('base64url');
    await tx.form.create({
      data: {
        id: formId,
        baseId: base.id,
        sheetId: formSheet.id,
        name: '序列号领取',
        shareToken,
        fields: [{ fieldId: phone.id, required: true }] as Prisma.InputJsonValue,
        share: {
          enabled: true,
          audience: 'anyone',
          expiresAt: null,
        } as Prisma.InputJsonValue,
        // 成功页优先展示「发送消息」插值结果；此处仅作无该步骤时的兜底
        successTemplate: '',
        rejectDuplicatePhone: true,
      },
    });

    const automation = await tx.automation.create({
      data: {
        baseId: base.id,
        name: '联动修改：领取序列号',
        trigger: {
          type: 'recordCreated',
          sheetId: formSheet.id,
          filters: {
            conjunction: 'and',
            conditions: [
              { fieldId: phone.id, operator: 'isNotEmpty' },
            ],
          },
        } as Prisma.InputJsonValue,
        // Mirrors WeCom「联动修改」from automation/list:
        // LOOKUP_RECORD(type=1) → UPDATE_RECORD(type=3, selector=fromStep)
        // → SEND_MESSAGE(type=4, users=填写者, content=序列号).
        steps: [
          {
            id: 'find-code',
            type: 'findRecords',
            sheetId: codeSheet.id,
            limit: 1,
            onEmpty: 'stop',
            filters: {
              conjunction: 'and',
              conditions: [
                { fieldId: status.id, operator: 'equals', value: 'unclaimed' },
              ],
            },
          },
          {
            id: 'claim-code',
            type: 'modifyRecords',
            target: { mode: 'fromStep', stepId: 'find-code' },
            cells: {
              [status.id]: { kind: 'literal', value: 'claimed' },
              [claimedPhone.id]: {
                kind: 'variable',
                variable: { source: 'trigger', field: '手机号' },
              },
              [claimedAt.id]: {
                kind: 'variable',
                // Wall-clock stamp (WeCom update step only writes 状态+手机号;
                // our 领取时间 is an extension — use now, not date-only today).
                variable: { source: 'naturalTime', naturalTime: 'now' },
              },
            },
          },
          {
            id: 'notify-claimer',
            type: 'sendMessage',
            // WeCom: title「你的序列号为」+ content ref 修改步骤.序列号
            name: '你的序列号为',
            channel: 'doc',
            recipients: [{ source: 'trigger', field: '填写者' }],
            content: {
              text: '{{第3步.序列号}}',
              buttons: [],
            },
          },
        ] as Prisma.InputJsonValue,
        onFindEmpty: 'stop',
      },
    });

    return {
      baseId: base.id,
      formId,
      shareToken,
      automationId: automation.id,
    };
  });

  return {
    created: true,
    workspaceId: workspace.id,
    baseId: result.baseId,
    formId: result.formId,
    shareToken: result.shareToken,
    shareUrl: `${publicBase}/fill/${result.shareToken}`,
    automationId: result.automationId,
    demoAccount: DEMO_ACCOUNT,
    demoPassword: DEMO_PASSWORD,
    codes: CODE_COUNT,
  };
}
