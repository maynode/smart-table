<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { toast } from '../ui/toast';
import type { QuotaSnapshot } from '../api/types';

const props = defineProps<{ workspaceId: string }>();
const emit = defineEmits<{ close: [] }>();

const quota = ref<QuotaSnapshot | null>(null);
const maxSeats = ref(50);
const maxAutomationRunsPerMonth = ref(10000);
const maxStorageGb = ref(10);
const saving = ref(false);

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

async function load(): Promise<void> {
  try {
    const value = await endpoints.getQuota(props.workspaceId);
    quota.value = value;
    maxSeats.value = value.limits.maxSeats;
    maxAutomationRunsPerMonth.value = value.limits.maxAutomationRunsPerMonth;
    maxStorageGb.value = Math.round(value.limits.maxStorageBytes / 1024 ** 3);
  } catch (error) {
    toast(messageOf(error));
  }
}

const seatPercent = computed(() =>
  quota.value
    ? Math.min(100, (quota.value.usage.seats / quota.value.limits.maxSeats) * 100)
    : 0,
);
const runPercent = computed(() =>
  quota.value
    ? Math.min(
        100,
        (quota.value.usage.automationRunsThisMonth /
          quota.value.limits.maxAutomationRunsPerMonth) *
          100,
      )
    : 0,
);
const storagePercent = computed(() =>
  quota.value
    ? Math.min(
        100,
        (quota.value.usage.storageBytes / quota.value.limits.maxStorageBytes) *
          100,
      )
    : 0,
);

async function save(): Promise<void> {
  saving.value = true;
  try {
    await endpoints.updateInstallationQuota({
      maxSeats: maxSeats.value,
      maxAutomationRunsPerMonth: maxAutomationRunsPerMonth.value,
      maxStorageBytes: maxStorageGb.value * 1024 ** 3,
    });
    await load();
    toast('配额策略已保存');
  } catch (error) {
    toast(messageOf(error));
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="quota-panel" data-testid="quota-panel">
    <header class="quota-header">
      <div>
        <strong>配额与用量</strong>
        <p>席位、存储和自动化运行次数由安装管理员统一配置。</p>
      </div>
      <button class="icon-btn" data-testid="quota-close" @click="emit('close')">×</button>
    </header>

    <div v-if="quota" class="quota-body">
      <div class="usage-row">
        <div>
          <strong>席位</strong>
          <small>{{ quota.usage.seats }} / {{ quota.limits.maxSeats }}</small>
        </div>
        <div class="bar"><i :style="{ width: `${seatPercent}%` }" /></div>
      </div>
      <div class="usage-row">
        <div>
          <strong>自动化运行（本月）</strong>
          <small>
            {{ quota.usage.automationRunsThisMonth }} /
            {{ quota.limits.maxAutomationRunsPerMonth }}
          </small>
        </div>
        <div class="bar"><i :style="{ width: `${runPercent}%` }" /></div>
      </div>
      <div class="usage-row">
        <div>
          <strong>存储</strong>
          <small>
            {{ (quota.usage.storageBytes / 1024 ** 2).toFixed(2) }} MB /
            {{ (quota.limits.maxStorageBytes / 1024 ** 3).toFixed(1) }} GB
          </small>
        </div>
        <div class="bar"><i :style="{ width: `${storagePercent}%` }" /></div>
      </div>

      <div v-if="quota.canEdit" class="quota-form">
        <h4>安装级策略</h4>
        <label>
          最大席位数
          <input v-model.number="maxSeats" type="number" min="1" data-testid="quota-max-seats" />
        </label>
        <label>
          每月自动化运行上限
          <input
            v-model.number="maxAutomationRunsPerMonth"
            type="number"
            min="1"
            data-testid="quota-max-runs"
          />
        </label>
        <label>
          存储上限（GB）
          <input v-model.number="maxStorageGb" type="number" min="1" data-testid="quota-max-storage" />
        </label>
        <button
          class="btn btn-primary"
          :disabled="saving"
          data-testid="quota-save"
          @click="save"
        >
          保存策略
        </button>
      </div>
      <p v-else class="readonly-hint">
        当前账号不是安装管理员，只能查看用量；请联系部署管理员调整策略。
      </p>

      <div v-if="quota.exceeded.seats || quota.exceeded.automationRuns || quota.exceeded.storage" class="exceeded">
        已有配额超限，相关写入会被拒绝并返回明确错误码。
      </div>
    </div>
  </section>
</template>

<style scoped>
.quota-panel {
  width: min(540px, 92vw);
  max-height: 82vh;
  overflow: auto;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
}
.quota-header {
  display: flex;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e6eb;
}
.quota-header p {
  margin: 4px 0 0;
  color: #8a9099;
  font-size: 12px;
}
.quota-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px 22px;
}
.usage-row div:first-child {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 5px;
}
.usage-row small {
  color: #8a9099;
}
.bar {
  height: 6px;
  background: #eef0f3;
  border-radius: 999px;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: #2d6cdf;
}
.quota-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: #fafbfc;
  border: 1px solid #eef0f3;
  border-radius: 8px;
}
.quota-form h4 {
  margin: 0 0 2px;
}
.quota-form label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #646a73;
}
.quota-form input {
  width: 140px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
}
.readonly-hint,
.exceeded {
  font-size: 12px;
  color: #8a9099;
}
.exceeded {
  color: #d92d20;
  background: #fff1f0;
  padding: 8px 10px;
  border-radius: 6px;
}
</style>
