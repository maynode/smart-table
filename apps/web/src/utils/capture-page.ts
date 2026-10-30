import html2canvas from 'html2canvas';

/**
 * 截取当前视口。不改动真实 DOM（避免弹窗闪一下），
 * 仅在 html2canvas 克隆树里排除反馈层。
 */
export async function captureCurrentViewport(): Promise<Blob> {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const canvas = await html2canvas(document.documentElement, {
    useCORS: true,
    allowTaint: false,
    logging: false,
    scale: Math.min(window.devicePixelRatio || 1, 1.5),
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    x: window.scrollX,
    y: window.scrollY,
    scrollX: -window.scrollX,
    scrollY: -window.scrollY,
    ignoreElements: (el) =>
      el instanceof HTMLElement &&
      (el.dataset.feedbackCaptureIgnore === '1' ||
        el.classList.contains('toast-host')),
    onclone: (_doc, cloned) => {
      cloned
        .querySelectorAll('[data-feedback-capture-ignore="1"], .toast-host')
        .forEach((node) => node.remove());
    },
  });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (out) => {
        if (!out) reject(new Error('截图失败'));
        else resolve(out);
      },
      'image/jpeg',
      0.92,
    );
  });
  return blob;
}
