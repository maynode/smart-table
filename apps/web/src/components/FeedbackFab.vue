<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { endpoints } from '../api/endpoints';
import { messageOf } from '../api/error-message';
import { auth } from '../stores/auth';
import { toast } from '../ui/toast';
import { compressImageFile } from '../utils/compress-image';

const MAX_IMAGES = 3;

type DraftImage = {
  id: string;
  previewUrl: string;
  blob: Blob;
};

const route = useRoute();
const router = useRouter();
const open = ref(false);
const content = ref('');
const images = ref<DraftImage[]>([]);
const submitting = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const show = computed(
  () => auth.isAuthenticated.value && route.path !== '/login',
);
const isAdmin = computed(() => Boolean(auth.state.user?.installAdmin));

onMounted(() => {
  if (!auth.isAuthenticated.value) return;
  void endpoints
    .me()
    .then((user) => {
      auth.updateUser({
        id: user.id,
        account: user.account,
        name: user.name,
        avatarSeed: user.avatarSeed,
        avatarUrl: user.avatarUrl,
        installAdmin: user.installAdmin,
      });
    })
    .catch(() => {
      /* ignore */
    });
});

onBeforeUnmount(() => {
  clearImages();
});

function clearImages(): void {
  for (const item of images.value) URL.revokeObjectURL(item.previewUrl);
  images.value = [];
}

function openPanel(): void {
  open.value = true;
}

function closePanel(): void {
  open.value = false;
}

function pickFiles(): void {
  fileInput.value?.click();
}

async function onFilesSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = '';
  await addFiles(files);
}

async function onPaste(event: ClipboardEvent): Promise<void> {
  const items = event.clipboardData?.items;
  if (!items?.length) return;
  const files: File[] = [];
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (!files.length) return;
  event.preventDefault();
  await addFiles(files);
}

async function addFiles(files: File[]): Promise<void> {
  const room = MAX_IMAGES - images.value.length;
  if (room <= 0) {
    toast(`最多 ${MAX_IMAGES} 张图片`);
    return;
  }
  const slice = files.slice(0, room);
  if (files.length > room) {
    toast(`最多 ${MAX_IMAGES} 张，已忽略多余图片`);
  }
  for (const file of slice) {
    if (!file.type.startsWith('image/')) {
      toast('仅支持图片');
      continue;
    }
    try {
      const blob = await compressImageFile(file);
      const previewUrl = URL.createObjectURL(blob);
      images.value.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        previewUrl,
        blob,
      });
    } catch (error) {
      toast(messageOf(error) || '图片压缩失败');
    }
  }
}

function removeImage(id: string): void {
  const hit = images.value.find((item) => item.id === id);
  if (hit) URL.revokeObjectURL(hit.previewUrl);
  images.value = images.value.filter((item) => item.id !== id);
}

async function submit(): Promise<void> {
  const text = content.value.trim();
  if (!text && images.value.length === 0) {
    toast('请填写反馈内容或上传图片');
    return;
  }
  submitting.value = true;
  try {
    const imageUrls: string[] = [];
    for (const item of images.value) {
      const uploaded = await endpoints.uploadFeedbackAttachment(
        item.blob,
        'feedback.jpg',
      );
      imageUrls.push(uploaded.url);
    }
    await endpoints.submitFeedback({
      content: text,
      pagePath: route.fullPath,
      imageUrls,
    });
    content.value = '';
    clearImages();
    open.value = false;
    toast('已提交，感谢反馈');
  } catch (error) {
    toast(messageOf(error) || '提交失败');
  } finally {
    submitting.value = false;
  }
}

function goAdmin(): void {
  open.value = false;
  void router.push('/admin/feedback');
}
</script>

<template>
  <template v-if="show">
    <button
      type="button"
      class="feedback-fab"
      data-testid="feedback-fab"
      title="反馈问题"
      @click="openPanel"
    >
      反馈
    </button>

    <div
      v-if="open"
      class="feedback-backdrop"
      data-testid="feedback-dialog"
      @click.self="closePanel"
    >
      <div
        class="feedback-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
      >
        <header class="feedback-panel-head">
          <h2 id="feedback-title">反馈问题</h2>
          <button
            type="button"
            class="feedback-close"
            aria-label="关闭"
            @click="closePanel"
          >
            ×
          </button>
        </header>
        <p class="feedback-hint">
          描述问题或建议；可粘贴或上传截图（最多 {{ MAX_IMAGES }} 张，自动压缩）。
        </p>
        <textarea
          v-model="content"
          class="feedback-input"
          rows="5"
          maxlength="4000"
          placeholder="请尽量说明页面、操作步骤与期望结果…（也可 Ctrl+V 粘贴截图）"
          data-testid="feedback-content"
          @paste="onPaste"
        />

        <div class="feedback-images">
          <div
            v-for="item in images"
            :key="item.id"
            class="feedback-thumb"
          >
            <img :src="item.previewUrl" alt="" />
            <button
              type="button"
              class="feedback-thumb-remove"
              aria-label="移除图片"
              @click="removeImage(item.id)"
            >
              ×
            </button>
          </div>
          <button
            v-if="images.length < MAX_IMAGES"
            type="button"
            class="feedback-add-image"
            data-testid="feedback-add-image"
            @click="pickFiles"
          >
            + 图片
          </button>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          multiple
          hidden
          data-testid="feedback-file-input"
          @change="onFilesSelected"
        />

        <footer class="feedback-panel-foot">
          <button
            v-if="isAdmin"
            type="button"
            class="btn"
            data-testid="feedback-admin-link"
            @click="goAdmin"
          >
            反馈后台
          </button>
          <span class="feedback-spacer" />
          <button type="button" class="btn" @click="closePanel">取消</button>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="feedback-submit"
            :disabled="submitting"
            @click="submit"
          >
            {{ submitting ? '提交中…' : '提交' }}
          </button>
        </footer>
      </div>
    </div>
  </template>
</template>
