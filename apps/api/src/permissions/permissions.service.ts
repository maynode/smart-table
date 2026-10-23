import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { evaluateFilterGroup, type FilterGroup } from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SharingService } from '../sharing/sharing.service';

export type AclLevel = 'full' | 'edit' | 'view' | 'none';
export type AclAction = 'read' | 'create' | 'update' | 'delete';

export interface AclRecordRule {
  mode: 'all' | 'condition' | 'own';
  filter?: FilterGroup;
  canAdd?: boolean;
  canDelete?: boolean;
}

export interface AclFieldAccess {
  editable?: boolean;
  viewable?: boolean;
  submitOnce?: boolean;
}

export interface AclFieldRule {
  mode: 'all' | 'fields';
  fields?: Record<string, AclFieldAccess>;
  newFields?: AclFieldAccess;
}

export interface AclConfig {
  level: AclLevel;
  recordRule?: AclRecordRule;
  fieldRule?: AclFieldRule;
}

export interface AclDecision {
  objectType: string;
  objectId: string;
  workspaceId: string;
  baseId: string;
  role: string;
  level: AclLevel;
  recordRule?: AclRecordRule;
  fieldRule?: AclFieldRule;
}

type RecordLike = {
  id?: string;
  cells: unknown;
  createdBy?: string | null;
};

const LEVELS: readonly AclLevel[] = ['full', 'edit', 'view', 'none'];

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly sharing: SharingService,
  ) {}

  async resolveObject(objectType: string, objectId: string) {
    if (objectType === 'sheet') {
      const sheet = await this.prisma.sheet.findUnique({
        where: { id: objectId },
        include: { base: true },
      });
      if (!sheet) throw new NotFoundException('工作表不存在');
      return {
        workspaceId: sheet.base.workspaceId,
        baseId: sheet.baseId,
        name: sheet.name,
      };
    }
    if (objectType === 'form') {
      const form = await this.prisma.form.findUnique({
        where: { id: objectId },
        include: { base: true },
      });
      if (!form) throw new NotFoundException('表单不存在');
      return {
        workspaceId: form.base.workspaceId,
        baseId: form.baseId,
        name: form.name,
      };
    }
    if (objectType === 'dashboard') {
      const dashboard = await this.prisma.dashboard.findUnique({
        where: { id: objectId },
        include: { base: true },
      });
      if (!dashboard) throw new NotFoundException('仪表盘不存在');
      return {
        workspaceId: dashboard.base.workspaceId,
        baseId: dashboard.baseId,
        name: dashboard.name,
      };
    }
    throw new BadRequestException('不支持的对象类型');
  }

  async decision(
    objectType: string,
    objectId: string,
    userId: string,
  ): Promise<AclDecision> {
    const object = await this.resolveObject(objectType, objectId);
    let role: WorkspaceRole;
    try {
      const membership = await this.workspacesService.requireMember(
        object.workspaceId,
        userId,
      );
      role = membership.role;
    } catch (error) {
      if (objectType !== 'sheet') throw error;
      const shared = await this.sharing.roleForObject(
        'sheet',
        objectId,
        userId,
      );
      if (!shared) throw error;
      role = shared.role;
    }
    const rows = await this.prisma.contentPermission.findMany({
      where: { objectType, objectId },
    });
    const everyone = rows.find((row) => row.subjectType === 'everyone');
    const member = rows.find(
      (row) => row.subjectType === 'member' && row.subjectId === userId,
    );

    if (role === 'owner' || role === 'admin') {
      return {
        objectType,
        objectId,
        workspaceId: object.workspaceId,
        baseId: object.baseId,
        role,
        level: 'full',
      };
    }

    const defaultLevel: AclLevel = role === 'editor' ? 'edit' : 'view';
    const level = this.parseLevel(
      member?.level ?? everyone?.level ?? defaultLevel,
    );
    return {
      objectType,
      objectId,
      workspaceId: object.workspaceId,
      baseId: object.baseId,
      role,
      level,
      recordRule: (member?.recordRule ?? everyone?.recordRule ??
        undefined) as AclRecordRule | undefined,
      fieldRule: (member?.fieldRule ?? everyone?.fieldRule ??
        undefined) as AclFieldRule | undefined,
    };
  }

  async assertCan(
    objectType: string,
    objectId: string,
    userId: string,
    action: AclAction,
    context?: {
      record?: RecordLike;
      changes?: Record<string, unknown>;
    },
  ): Promise<AclDecision> {
    const decision = await this.decision(objectType, objectId, userId);
    if (decision.level === 'none') {
      throw new ForbiddenException('无权限访问该内容');
    }
    if (decision.role === 'owner' || decision.role === 'admin') {
      return decision;
    }

    if (action === 'read') {
      if (
        context?.record &&
        !this.rowVisible(decision, userId, context.record)
      ) {
        throw new ForbiddenException('无权查看该记录');
      }
      return decision;
    }

    if (action === 'create') {
      if (!this.canEdit(decision.level)) {
        throw new ForbiddenException('无权限新增记录');
      }
      if (decision.recordRule?.canAdd === false) {
        throw new ForbiddenException('当前权限不允许新增记录');
      }
      this.assertFieldWrites(decision, context?.changes ?? {}, {});
      return decision;
    }

    if (action === 'update') {
      if (!this.canEdit(decision.level)) {
        throw new ForbiddenException('无权限编辑记录');
      }
      if (
        context?.record &&
        !this.rowVisible(decision, userId, context.record)
      ) {
        throw new ForbiddenException('该记录不在可编辑范围内');
      }
      const existing = (context?.record?.cells ?? {}) as Record<string, unknown>;
      this.assertFieldWrites(decision, context?.changes ?? {}, existing);
      return decision;
    }

    if (action === 'delete') {
      const allowed =
        decision.level === 'full' ||
        (this.canEdit(decision.level) &&
          decision.recordRule?.canDelete === true);
      if (!allowed) {
        throw new ForbiddenException('无权限删除记录');
      }
      if (decision.recordRule?.canDelete === false) {
        throw new ForbiddenException('当前权限不允许删除记录');
      }
      if (
        context?.record &&
        !this.rowVisible(decision, userId, context.record)
      ) {
        throw new ForbiddenException('该记录不在可删除范围内');
      }
      return decision;
    }

    return decision;
  }

  applyReadScope<T extends RecordLike>(
    decision: AclDecision,
    records: T[],
    userId: string,
  ): T[] {
    return records
      .filter((record) => this.rowVisible(decision, userId, record))
      .map((record) => this.stripRecord(decision, record));
  }

  stripRecord<T extends RecordLike>(decision: AclDecision, record: T): T {
    if (decision.role === 'owner' || decision.role === 'admin') return record;
    const rule = decision.fieldRule;
    if (rule?.mode !== 'fields' || !rule.fields) return record;
    const source = (record.cells ?? {}) as Record<string, unknown>;
    const cells: Record<string, unknown> = {};
    for (const [fieldId, value] of Object.entries(source)) {
      if (rule.fields[fieldId]?.viewable === false) continue;
      cells[fieldId] = value;
    }
    return { ...record, cells };
  }

  visibleFieldIds(decision: AclDecision): Set<string> | null {
    const rule = decision.fieldRule;
    if (decision.role === 'owner' || decision.role === 'admin') return null;
    if (rule?.mode !== 'fields' || !rule.fields) return null;
    return new Set(
      Object.entries(rule.fields)
        .filter(([, access]) => access.viewable !== false)
        .map(([fieldId]) => fieldId),
    );
  }

  filterVisibleFields<T extends { id: string }>(
    decision: AclDecision,
    fields: T[],
  ): T[] {
    const visible = this.visibleFieldIds(decision);
    if (!visible) return fields;
    return fields.filter((field) => visible.has(field.id));
  }

  async listForBase(baseId: string, userId: string) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) throw new NotFoundException('Base 不存在');
    await this.workspacesService.requireMember(base.workspaceId, userId);

    const [sheets, forms] = await Promise.all([
      this.prisma.sheet.findMany({
        where: { baseId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.form.findMany({
        where: { baseId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const objects = [];
    for (const sheet of sheets) {
      const decision = await this.decision('sheet', sheet.id, userId);
      objects.push({
        objectType: 'sheet',
        objectId: sheet.id,
        name: sheet.name,
        kind: '工作表',
        level: decision.level,
      });
    }
    for (const form of forms) {
      const decision = await this.decision('form', form.id, userId);
      objects.push({
        objectType: 'form',
        objectId: form.id,
        name: form.name,
        kind: '收集表单',
        level: decision.level,
      });
    }
    const dashboards = await this.prisma.dashboard.findMany({
      where: { baseId },
      orderBy: { createdAt: 'asc' },
    });
    for (const dashboard of dashboards) {
      const decision = await this.decision('dashboard', dashboard.id, userId);
      objects.push({
        objectType: 'dashboard',
        objectId: dashboard.id,
        name: dashboard.name,
        kind: dashboard.kind === 'report' ? '分析报告' : '仪表盘',
        level: decision.level,
      });
    }
    return { baseId, objects };
  }

  async removeMember(
    objectType: string,
    objectId: string,
    userId: string,
    memberId: string,
  ) {
    const object = await this.resolveObject(objectType, objectId);
    await this.workspacesService.requireMember(
      object.workspaceId,
      userId,
      'admin',
    );
    await this.prisma.contentPermission.deleteMany({
      where: {
        objectType,
        objectId,
        subjectType: 'member',
        subjectId: memberId,
      },
    });
    return this.getSettings(objectType, objectId, userId);
  }

  async getSettings(objectType: string, objectId: string, userId: string) {
    const object = await this.resolveObject(objectType, objectId);
    const membership = await this.workspacesService.requireMember(
      object.workspaceId,
      userId,
    );
    const decision = await this.decision(objectType, objectId, userId);
    const rows = await this.prisma.contentPermission.findMany({
      where: { objectType, objectId },
      orderBy: { createdAt: 'asc' },
    });
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: object.workspaceId },
      include: { user: { select: { id: true, name: true, account: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const userById = new Map(
      members.map((member) => [member.userId, member.user]),
    );
    const everyone = rows.find((row) => row.subjectType === 'everyone');
    const memberRows = rows.filter((row) => row.subjectType === 'member');

    return {
      objectType,
      objectId,
      name: object.name,
      baseId: object.baseId,
      canManage: membership.role === 'owner' || membership.role === 'admin',
      role: membership.role,
      effective: {
        level: decision.level,
        recordRule: decision.recordRule ?? null,
        fieldRule: decision.fieldRule ?? null,
      },
      everyone: everyone
        ? {
            level: everyone.level,
            recordRule: everyone.recordRule,
            fieldRule: everyone.fieldRule,
          }
        : null,
      members: memberRows.map((row) => ({
        userId: row.subjectId,
        name: userById.get(row.subjectId)?.name ?? '',
        account: userById.get(row.subjectId)?.account ?? '',
        level: row.level,
        recordRule: row.recordRule,
        fieldRule: row.fieldRule,
      })),
      workspaceMembers: members.map((member) => ({
        userId: member.userId,
        name: member.user.name,
        account: member.user.account,
        role: member.role,
      })),
    };
  }

  async updateSettings(
    objectType: string,
    objectId: string,
    userId: string,
    body: {
      everyone?: AclConfig | null;
      members?: Array<AclConfig & { userId: string }>;
    },
  ) {
    const object = await this.resolveObject(objectType, objectId);
    await this.workspacesService.requireMember(
      object.workspaceId,
      userId,
      'admin',
    );

    const everyone = body.everyone;
    const members = Array.isArray(body.members) ? body.members : [];

    await this.prisma.$transaction(async (tx) => {
      if (everyone) {
        const config = this.validateConfig(everyone);
        await tx.contentPermission.upsert({
          where: {
            objectType_objectId_subjectType_subjectId: {
              objectType,
              objectId,
              subjectType: 'everyone',
              subjectId: '',
            },
          },
          create: {
            workspaceId: object.workspaceId,
            objectType,
            objectId,
            subjectType: 'everyone',
            subjectId: '',
            level: config.level,
            recordRule: config.recordRule as unknown as Prisma.InputJsonValue,
            fieldRule: config.fieldRule as unknown as Prisma.InputJsonValue,
          },
          update: {
            level: config.level,
            recordRule: config.recordRule as unknown as Prisma.InputJsonValue,
            fieldRule: config.fieldRule as unknown as Prisma.InputJsonValue,
          },
        });
      }

      if (Array.isArray(body.members)) {
        await tx.contentPermission.deleteMany({
          where: { objectType, objectId, subjectType: 'member' },
        });
        for (const member of members) {
          const config = this.validateConfig(member);
          if (!member.userId) {
            throw new BadRequestException('成员权限缺少 userId');
          }
          await tx.contentPermission.create({
            data: {
              workspaceId: object.workspaceId,
              objectType,
              objectId,
              subjectType: 'member',
              subjectId: member.userId,
              level: config.level,
              recordRule: config.recordRule as unknown as Prisma.InputJsonValue,
              fieldRule: config.fieldRule as unknown as Prisma.InputJsonValue,
            },
          });
        }
      }
    });

    return this.getSettings(objectType, objectId, userId);
  }

  private validateConfig(config: AclConfig): AclConfig {
    if (!config || typeof config !== 'object') {
      throw new BadRequestException('权限配置无效');
    }
    const level = this.parseLevel(config.level);
    return {
      level,
      recordRule: this.validateRecordRule(config.recordRule),
      fieldRule: this.validateFieldRule(config.fieldRule),
    };
  }

  private validateRecordRule(rule?: AclRecordRule): AclRecordRule | undefined {
    if (!rule) return undefined;
    if (!['all', 'condition', 'own'].includes(rule.mode)) {
      throw new BadRequestException('记录权限范围无效');
    }
    if (rule.mode === 'condition' && !rule.filter) {
      throw new BadRequestException('条件范围缺少筛选条件');
    }
    return {
      mode: rule.mode,
      filter: rule.filter,
      canAdd: rule.canAdd,
      canDelete: rule.canDelete,
    };
  }

  private validateFieldRule(rule?: AclFieldRule): AclFieldRule | undefined {
    if (!rule) return undefined;
    if (!['all', 'fields'].includes(rule.mode)) {
      throw new BadRequestException('字段权限模式无效');
    }
    return rule;
  }

  private parseLevel(level: string): AclLevel {
    if (!LEVELS.includes(level as AclLevel)) {
      throw new BadRequestException('权限档位无效');
    }
    return level as AclLevel;
  }

  private canEdit(level: AclLevel): boolean {
    return level === 'edit' || level === 'full';
  }

  private rowVisible(
    decision: AclDecision,
    userId: string,
    record: RecordLike,
  ): boolean {
    if (decision.role === 'owner' || decision.role === 'admin') return true;
    const rule = decision.recordRule;
    if (!rule || rule.mode === 'all') return true;
    if (rule.mode === 'own') return record.createdBy === userId;
    if (!rule.filter) return true;
    return evaluateFilterGroup(
      rule.filter,
      (record.cells ?? {}) as Record<string, unknown>,
    );
  }

  private assertFieldWrites(
    decision: AclDecision,
    changes: Record<string, unknown>,
    existing: Record<string, unknown>,
  ): void {
    if (decision.role === 'owner' || decision.role === 'admin') return;
    const rule = decision.fieldRule;
    if (rule?.mode !== 'fields') return;

    for (const fieldId of Object.keys(changes)) {
      const access = rule.fields?.[fieldId] ?? rule.newFields;
      if (!access) continue;
      if (access.editable === false) {
        const firstSubmit =
          access.submitOnce === true &&
          (existing[fieldId] === undefined ||
            existing[fieldId] === null ||
            existing[fieldId] === '');
        if (!firstSubmit) {
          throw new ForbiddenException('该字段无编辑权限');
        }
      }
    }
  }
}
