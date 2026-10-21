<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { toast } from '../ui/toast';
import type {
  AclFieldAccess,
  AclLevel,
  FieldDto,
  PermissionObjectDto,
  PermissionSettingsDto,
} from '../api/types';

const props = defineProps<{ baseId: string }>();
const emit = defineEmits<{ close: [] }>();

const objects = ref<PermissionObjectDto[]>([]);
const selected = ref<PermissionObjectDto | null>(null);
const settings = ref<PermissionSettingsDto | null>(null);
const fields = ref<FieldDto[]>([]);
const loading = ref(false);
const saving = ref(false);

const level = ref<AclLevel>('edit');
const recordMode = ref<'all' | 'condition' | 'own'>('all');
const canAdd = ref(true);
const canDelete = ref(false);
const conditionField = ref('');
const conditionOperator = ref('equals');
const conditionValue = ref('');
const fieldMode = ref<'all' | 'fields'>('all');
const access = ref<Record<string, AclFieldAccess>>({});
const memberRows = ref<Array<{ userId: string; level: AclLevel }>>([]);
const addMemberId = ref('');
const addMemberLevel = ref<AclLevel>('view');

const levels: Array<{ value: AclLevel; label: string }> = [
  { value: 'full', label: '全部权限' },
  { value: 'edit', label: '可编辑' },
  { value: 'view', label: '仅浏览' },
  { value: 'none', label: '无权限' },
];

const memberCandidates = computed(() =>
  (settings.value?.workspaceMembers ?? []).filter(
    (member) =>
      member.role !== 'owner' &&
      !memberRows.value.some((row) => row.userId === member.userId),
  ),
);

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

function accessOf(fieldId: string): AclFieldAccess {
  return (
    access.value[fieldId] ?? {
      editable: true,
      viewable: true,
      submitOnce: false,
    }
  );
}

function setAccess<K extends keyof AclFieldAccess>(
  fieldId: string,
  key: K,
  value: AclFieldAccess[K],
): void {
  access.value = {
    ...access.value,
    [fieldId]: { ...accessOf(fieldId), [key]: value },
  };
}

async function loadObjects(): Promise<void> {
  loading.value = true;
  try {
    const result = await endpoints.listPermissionObjects(props.baseId);
    objects.value = result.objects;
    if (result.objects[0]) await selectObject(result.objects[0]);
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

async function selectObject(object: PermissionObjectDto): Promise<void> {
  selected.value = object;
  loading.value = true;
  try {
    const detail = await endpoints.getPermissionSettings(
      object.objectType,
      object.objectId,
    );
    settings.value = detail;
    level.value = detail.everyone?.level ?? detail.effective.level;
    const rule = detail.everyone?.recordRule;
    recordMode.value = rule?.mode ?? 'all';
    canAdd.value = rule?.canAdd !== false;
    canDelete.value = rule?.canDelete === true;
    const filter = (rule?.filter ?? null) as {
      conditions?: Array<{
        fieldId?: string;
        operator?: string;
        value?: unknown;
      }>;
    } | null;
    const condition = filter?.conditions?.[0];
    conditionField.value = condition?.fieldId ?? '';
    conditionOperator.value = condition?.operator ?? 'equals';
    conditionValue.value =
      condition?.value === undefined ? '' : String(condition.value);

    fieldMode.value = detail.everyone?.fieldRule?.mode ?? 'all';
    access.value = { ...(detail.everyone?.fieldRule?.fields ?? {}) };
    memberRows.value = detail.members.map((member) => ({
      userId: member.userId,
      level: member.level,
    }));

    fields.value =
      object.objectType === 'sheet'
        ? ((await endpoints.getSheet(object.objectId)).fields ?? [])
        : [];
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

function addMember(): void {
  if (!addMemberId.value) return;
  memberRows.value = [
    ...memberRows.value,
    { userId: addMemberId.value, level: addMemberLevel.value },
  ];
  addMemberId.value = '';
}

function removeMember(userId: string): void {
  memberRows.value = memberRows.value.filter((row) => row.userId !== userId);
}

async function save(): Promise<void> {
  if (!selected.value || !settings.value) return;
  if (recordMode.value === 'condition' && !conditionField.value) {
    toast('请选择记录范围的条件字段');
    return;
  }
  saving.value = true;
  try {
    const recordRule: Record<string, unknown> = {
      mode: recordMode.value,
      canAdd: canAdd.value,
      canDelete: canDelete.value,
    };
    if (recordMode.value === 'condition') {
      recordRule.filter = {
        conjunction: 'and',
        conditions: [
          {
            fieldId: conditionField.value,
            operator: conditionOperator.value,
            value: conditionValue.value,
          },
        ],
      };
    }

    const fieldRule: Record<string, unknown> = { mode: fieldMode.value };
    if (fieldMode.value === 'fields') {
      fieldRule.fields = access.value;
    }

    settings.value = await endpoints.updatePermissionSettings(
      selected.value.objectType,
      selected.value.objectId,
      {
        everyone: { level: level.value, recordRule, fieldRule },
        members: memberRows.value.map((row) => ({
          userId: row.userId,
          level: row.level,
        })),
      },
    );
    selected.value.level = level.value;
    toast('权限已保存');
  } catch (error) {
    toast(messageOf(error));
  } finally {
    saving.value = false;
  }
}

onMounted(loadObjects);
</script>

<template>
  <section class="permission-panel" data-testid="permissions-panel">
    <header class="panel-header">
      <div>
        <strong>内容权限</strong>
        <p class="panel-subtitle">
          设置全员与指定成员对工作表/表单的访问档位、记录范围与字段权限。
        </p>
      </div>
      <button class="icon-btn" data-testid="permissions-close" @click="emit('close')">
        ×
      </button>
    </header>

    <div class="permission-body">
      <aside class="object-list">
        <p class="section-label">对象</p>
        <button
          v-for="object in objects"
          :key="object.objectId"
          class="object-row"
          :class="{ active: selected?.objectId === object.objectId }"
          data-testid="permission-object-row"
          @click="selectObject(object)"
        >
          <span>
            <strong>{{ object.name }}</strong>
            <small>{{ object.kind }}</small>
          </span>
          <span class="level-badge">{{ levels.find((item) => item.value === object.level)?.label }}</span>
        </button>
        <p v-if="!objects.length && !loading" class="empty-hint">暂无对象</p>
      </aside>

      <div v-if="settings" class="detail">
        <div class="detail-head">
          <div>
            <strong>{{ settings.name }}</strong>
            <p class="panel-subtitle">全员权限对可编辑/仅浏览成员生效。</p>
          </div>
          <label class="level-select">
            档位
            <select v-model="level" data-testid="permission-level" :disabled="!settings.canManage">
              <option v-for="item in levels" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </label>
        </div>

        <fieldset class="rule-block">
          <legend>记录权限（行）</legend>
          <div class="rule-row">
            <label>
              可编辑范围
              <select v-model="recordMode" data-testid="permission-record-mode">
                <option value="all">全部记录</option>
                <option value="condition">符合条件的记录</option>
                <option value="own">自己创建的记录</option>
              </select>
            </label>
            <label v-if="recordMode === 'condition'" class="condition-row">
              条件
              <select v-model="conditionField" data-testid="permission-condition-field">
                <option value="">字段</option>
                <option v-for="field in fields" :key="field.id" :value="field.id">
                  {{ field.name }}
                </option>
              </select>
              <select v-model="conditionOperator">
                <option value="equals">等于</option>
                <option value="notEquals">不等于</option>
                <option value="contains">包含</option>
                <option value="isNotEmpty">不为空</option>
              </select>
              <input v-model="conditionValue" data-testid="permission-condition-value" placeholder="值" />
            </label>
          </div>
          <div class="toggle-row">
            <label>
              <input v-model="canAdd" type="checkbox" data-testid="permission-can-add" />
              可添加记录
            </label>
            <label>
              <input v-model="canDelete" type="checkbox" data-testid="permission-can-delete" />
              可删除记录
            </label>
          </div>
        </fieldset>

        <fieldset class="rule-block">
          <legend>字段权限（列）</legend>
          <label class="mode-row">
            <input
              v-model="fieldMode"
              type="radio"
              value="all"
              data-testid="permission-field-mode-all"
            />
            可编辑所有内容
          </label>
          <label class="mode-row">
            <input
              v-model="fieldMode"
              type="radio"
              value="fields"
              data-testid="permission-field-mode-fields"
            />
            按字段设置
          </label>

          <div v-if="fieldMode === 'fields'" class="field-table">
            <div class="field-table-head">
              <span>字段</span>
              <span>可编辑</span>
              <span>可首次提交</span>
              <span>可查看</span>
            </div>
            <div
              v-for="field in fields"
              :key="field.id"
              class="field-table-row"
              data-testid="permission-field-row"
            >
              <span>{{ field.name }}</span>
              <input
                :checked="accessOf(field.id).editable"
                type="checkbox"
                data-testid="permission-field-editable"
                @change="setAccess(field.id, 'editable', ($event.target as HTMLInputElement).checked)"
              />
              <input
                :checked="accessOf(field.id).submitOnce"
                type="checkbox"
                data-testid="permission-field-submit-once"
                @change="setAccess(field.id, 'submitOnce', ($event.target as HTMLInputElement).checked)"
              />
              <input
                :checked="accessOf(field.id).viewable"
                type="checkbox"
                data-testid="permission-field-viewable"
                @change="setAccess(field.id, 'viewable', ($event.target as HTMLInputElement).checked)"
              />
            </div>
            <p v-if="!fields.length" class="empty-hint">该对象没有可配置字段。</p>
          </div>
        </fieldset>

        <fieldset class="rule-block">
          <legend>指定成员额外权限</legend>
          <div class="member-add">
            <select v-model="addMemberId" data-testid="permission-member-select">
              <option value="">选择成员</option>
              <option
                v-for="member in memberCandidates"
                :key="member.userId"
                :value="member.userId"
              >
                {{ member.name || member.email }}
              </option>
            </select>
            <select v-model="addMemberLevel">
              <option v-for="item in levels" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
            <button class="btn" data-testid="permission-add-member" @click="addMember">
              添加
            </button>
          </div>
          <div
            v-for="row in memberRows"
            :key="row.userId"
            class="member-row"
            data-testid="permission-member-row"
          >
            <span>
              {{
                settings.workspaceMembers.find((member) => member.userId === row.userId)
                  ?.name || row.userId
              }}
            </span>
            <select v-model="row.level" data-testid="permission-member-level">
              <option v-for="item in levels" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
            <button class="icon-btn" @click="removeMember(row.userId)">×</button>
          </div>
          <p v-if="!memberRows.length" class="empty-hint">未添加额外成员权限。</p>
        </fieldset>
      </div>
      <div v-else class="detail empty-detail">选择左侧对象查看权限。</div>
    </div>

    <footer class="panel-footer">
      <button class="btn" @click="emit('close')">取消</button>
      <button
        class="btn btn-primary"
        data-testid="permission-save"
        :disabled="saving || !settings?.canManage"
        @click="save"
      >
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.permission-panel {
  display: flex;
  flex-direction: column;
  width: min(1040px, 94vw);
  height: min(760px, 88vh);
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 18px 22px;
  border-bottom: 1px solid #e5e6eb;
}
.panel-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: #8a9099;
}
.permission-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.object-list {
  width: 260px;
  border-right: 1px solid #e5e6eb;
  overflow: auto;
  padding: 12px;
  background: #fafbfc;
}
.section-label {
  margin: 4px 8px 8px;
  font-size: 12px;
  color: #8a9099;
}
.object-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 10px 12px;
  margin-bottom: 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.object-row.active {
  background: #eef4ff;
  border-color: #cfe0ff;
}
.object-row span:first-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.object-row small {
  color: #8a9099;
}
.level-badge {
  font-size: 11px;
  color: #1d6fdc;
  white-space: nowrap;
}
.detail {
  flex: 1;
  overflow: auto;
  padding: 18px 22px 24px;
}
.empty-detail {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a9099;
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
}
.level-select {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #646a73;
}
.rule-block {
  margin-top: 18px;
  padding: 14px;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
}
.rule-block legend {
  padding: 0 6px;
  color: #646a73;
  font-size: 13px;
}
.rule-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.rule-row label,
.condition-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #646a73;
}
select,
input[type='text'],
input[type='number'],
input:not([type]) {
  height: 30px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  background: #fff;
}
input[type='checkbox'],
input[type='radio'] {
  width: 16px;
  height: 16px;
}
.toggle-row,
.mode-row {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-top: 12px;
  font-size: 12px;
  color: #646a73;
}
.mode-row {
  margin-top: 8px;
}
.field-table {
  margin-top: 12px;
  border: 1px solid #eef0f3;
  border-radius: 8px;
  overflow: hidden;
}
.field-table-head,
.field-table-row {
  display: grid;
  grid-template-columns: 1fr 80px 100px 80px;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
}
.field-table-head {
  background: #f7f8fa;
  color: #8a9099;
}
.field-table-row + .field-table-row {
  border-top: 1px solid #f0f1f3;
}
.member-add {
  display: flex;
  gap: 8px;
  align-items: center;
}
.member-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f8f9fb;
  font-size: 13px;
}
.panel-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px;
  border-top: 1px solid #e5e6eb;
}
.empty-hint {
  font-size: 12px;
  color: #8a9099;
}
</style>
