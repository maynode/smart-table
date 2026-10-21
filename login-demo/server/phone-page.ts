interface PhonePageOptions {
  ticketId: string
  appName: string
  expiresAt: number
}

/**
 * 模拟“手机扫码后打开的微信授权确认页”。
 * 真实世界里这是微信客户端里的页面，这里用一张服务端渲染的 HTML 代替。
 */
export function renderPhonePage({ ticketId, appName, expiresAt }: PhonePageOptions): string {
  const safeTicket = ticketId.replace(/[^\w-]/g, '')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${appName} · 微信登录（模拟）</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    background: #f2f3f5;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #1a1a1a; display: flex; flex-direction: column;
  }
  .nav {
    height: 48px; display: flex; align-items: center; gap: 8px; padding: 0 16px;
    background: #fff; font-size: 16px; font-weight: 600; border-bottom: 1px solid #ececec;
  }
  .nav .dot { width: 8px; height: 8px; border-radius: 50%; background: #07c160; }
  main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card {
    width: 100%; max-width: 360px; background: #fff; border-radius: 20px;
    padding: 32px 24px 24px; text-align: center; box-shadow: 0 12px 40px rgba(0,0,0,.06);
  }
  .logo {
    width: 64px; height: 64px; border-radius: 18px; margin: 0 auto 16px;
    background: linear-gradient(135deg, #10b981, #059669);
    color: #fff; font-size: 30px; font-weight: 700; line-height: 64px;
    box-shadow: 0 10px 24px rgba(5,150,105,.25);
  }
  h1 { font-size: 18px; margin: 0 0 6px; }
  .sub { color: #8a8f99; font-size: 13px; margin: 0 0 22px; }
  .state {
    font-size: 14px; padding: 12px; border-radius: 12px; background: #f7f8fa;
    color: #4b5563; margin-bottom: 20px; line-height: 1.6;
  }
  .state.error { background: #fef2f2; color: #b91c1c; }
  .actions { display: flex; flex-direction: column; gap: 10px; }
  button {
    height: 46px; border-radius: 12px; border: 0; font-size: 15px; font-weight: 600;
    cursor: pointer; font-family: inherit;
  }
  #ok { background: #07c160; color: #fff; }
  #ok:disabled { background: #9be3b9; cursor: not-allowed; }
  #no { background: #f4f5f6; color: #4b5563; }
  .tip { margin: 20px 0 0; font-size: 12px; color: #a6abb3; line-height: 1.6; }
  .done { font-size: 15px; color: #059669; font-weight: 600; }
  .done .icon { display: block; font-size: 40px; margin-bottom: 10px; }
</style>
</head>
<body>
  <div class="nav"><span class="dot"></span>微信登录</div>
  <main>
    <div class="card">
      <div class="logo">S</div>
      <h1>${appName}</h1>
      <p class="sub">申请使用你的微信身份进行登录</p>
      <div class="state" id="state">正在读取二维码…</div>
      <div class="actions" id="actions">
        <button id="ok" disabled>允许</button>
        <button id="no">取消</button>
      </div>
      <p class="tip">这是本地 mock 页面，不会真的登录微信。确认后请回到电脑端，页面会自动完成登录。</p>
    </div>
  </main>
<script>
  const ticket = ${JSON.stringify(safeTicket)};
  const expiresAt = ${JSON.stringify(expiresAt)};
  const stateEl = document.getElementById('state');
  const okBtn = document.getElementById('ok');
  const noBtn = document.getElementById('no');
  const actions = document.getElementById('actions');

  function setState(text, isError) {
    stateEl.textContent = text;
    stateEl.classList.toggle('error', Boolean(isError));
  }
  function post(path) {
    return fetch(path, { method: 'POST' }).then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }));
  }
  function fail(text) {
    setState(text, true);
    actions.innerHTML = '<button id="no">返回</button>';
    document.getElementById('no').onclick = () => history.length > 1 ? history.back() : location.reload();
  }
  function finish(title, text) {
    actions.innerHTML = '';
    stateEl.outerHTML = '<div class="state"><span class="done"><span class="icon">✓</span>' + title + '</span><br><span style="font-size:13px;color:#8a8f99">' + text + '</span></div>';
  }

  async function boot() {
    if (!ticket) return fail('缺少票据参数');
    if (expiresAt && Date.now() > expiresAt) return fail('二维码已过期，请回到电脑端刷新');
    const res = await post('/api/login/qr/' + encodeURIComponent(ticket) + '/scan');
    if (!res.ok) return fail(res.data.error || '二维码已失效，请回到电脑端刷新');
    setState('已扫描，请在手机上确认登录');
    okBtn.disabled = false;
  }

  okBtn.onclick = async () => {
    okBtn.disabled = true;
    okBtn.textContent = '处理中…';
    const res = await post('/api/login/qr/' + encodeURIComponent(ticket) + '/confirm');
    if (!res.ok) return fail(res.data.error || '确认失败，请回到电脑端重试');
    finish('已确认登录', '请回到电脑端继续');
  };

  noBtn.onclick = async () => {
    const res = await post('/api/login/qr/' + encodeURIComponent(ticket) + '/cancel');
    if (!res.ok) return fail(res.data.error || '操作失败');
    finish('已取消', '你可以在电脑端重新发起登录');
  };

  boot();
</script>
</body>
</html>`
}
