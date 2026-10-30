/** postMessage protocol between host page and aiComponent iframe. */

export const AI_COMPONENT_CHANNEL = 'smart-table-ai-component';

export type AiComponentHostToFrame =
  | { channel: typeof AI_COMPONENT_CHANNEL; type: 'init'; value: unknown }
  | { channel: typeof AI_COMPONENT_CHANNEL; type: 'cellChanged'; value: unknown }
  | {
      channel: typeof AI_COMPONENT_CHANNEL;
      type: 'rpcResult';
      id: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    };

export type AiComponentFrameToHost =
  | { channel: typeof AI_COMPONENT_CHANNEL; type: 'ready' }
  | {
      channel: typeof AI_COMPONENT_CHANNEL;
      type: 'rpc';
      id: string;
      method: 'getCell' | 'setCell' | 'getRow' | 'setRow' | 'runAutomation' | 'notify';
      args?: unknown[];
    };

export function isFrameMessage(data: unknown): data is AiComponentFrameToHost {
  if (!data || typeof data !== 'object') return false;
  const msg = data as Record<string, unknown>;
  return msg.channel === AI_COMPONENT_CHANNEL && typeof msg.type === 'string';
}

/** Injected into iframe before user JS. Exposes window.smartTable bridge. */
export function bridgeBootstrapScript(): string {
  return `
(function () {
  var CHANNEL = ${JSON.stringify(AI_COMPONENT_CHANNEL)};
  var pending = {};
  function rpc(method, args) {
    return new Promise(function (resolve, reject) {
      var id = Math.random().toString(36).slice(2);
      pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ channel: CHANNEL, type: 'rpc', id: id, method: method, args: args || [] }, '*');
    });
  }
  window.smartTable = {
    ready: function () { parent.postMessage({ channel: CHANNEL, type: 'ready' }, '*'); },
    getCell: function () { return rpc('getCell'); },
    setCell: function (value) { return rpc('setCell', [value]); },
    getRow: function (fieldIds) { return rpc('getRow', [fieldIds]); },
    setRow: function (patch) { return rpc('setRow', [patch]); },
    runAutomation: function (automationId, payload) { return rpc('runAutomation', [automationId, payload]); },
    notify: function (message) { return rpc('notify', [message]); }
  };
  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data || data.channel !== CHANNEL) return;
    if (data.type === 'rpcResult' && pending[data.id]) {
      var p = pending[data.id];
      delete pending[data.id];
      if (data.ok) p.resolve(data.result);
      else p.reject(new Error(data.error || 'bridge error'));
    }
    if (data.type === 'init' || data.type === 'cellChanged') {
      window.dispatchEvent(new CustomEvent('smartTable:cell', { detail: data.value }));
    }
  });
})();
`;
}

export function buildSrcDoc(bundle: {
  html: string;
  css?: string;
  js?: string;
}): string {
  const css = bundle.css ? `<style>${bundle.css}</style>` : '';
  const userJs = bundle.js ? `<script>${bundle.js}</script>` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>${css}</head><body>
${bundle.html}
<script>${bridgeBootstrapScript()}<\/script>
${userJs}
<script>
(function () {
  if (!window.smartTable) return;
  // 先 ready，再主动拉一次单元格，避免宿主 post(init) 赶在 iframeRef 绑定前空发
  window.smartTable.ready();
  window.smartTable.getCell().then(function (v) {
    window.dispatchEvent(new CustomEvent('smartTable:cell', { detail: v }));
  }).catch(function () {});
})();
<\/script>
</body></html>`;
}

/** Demo five-star rating bundle for tests / unpublished preview. */
export function demoRatingBundle(): { html: string; css: string; js: string } {
  return {
    html: `<div id="root" style="font:14px sans-serif;padding:8px"></div>`,
    css: `.star{cursor:pointer;font-size:22px;margin-right:2px}.on{color:#f5a623}.off{color:#ccc}`,
    js: `
(function(){
  var root = document.getElementById('root');
  var rating = 0;
  function render(){
    root.innerHTML = '';
    for (var i=1;i<=5;i++){
      var s = document.createElement('span');
      s.className = 'star ' + (i<=rating?'on':'off');
      s.textContent = '★';
      s.dataset.n = String(i);
      s.onclick = function(ev){
        rating = Number(ev.currentTarget.dataset.n);
        render();
        window.smartTable.setCell({ rating: rating });
      };
      root.appendChild(s);
    }
  }
  window.addEventListener('smartTable:cell', function(ev){
    var v = ev.detail;
    rating = v && typeof v.rating === 'number' ? v.rating : 0;
    render();
  });
  render();
})();
`,
  };
}
