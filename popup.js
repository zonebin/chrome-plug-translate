// popup.js — 快速开关与快捷设置。

(async function () {
  const toggleEl = document.getElementById('toggle');
  const statusEl = document.getElementById('status');
  const providerEl = document.getElementById('provider');
  const apiKeyEl = document.getElementById('apiKey');
  const targetLangEl = document.getElementById('targetLang');
  const modeEl = document.getElementById('mode');

  // 填语言下拉
  LANGUAGES.forEach((l) => {
    const o = document.createElement('option');
    o.value = l; o.textContent = l;
    targetLangEl.appendChild(o);
  });

  const settings = await getSettings();
  toggleEl.checked = settings.enabled;
  providerEl.value = settings.provider;
  apiKeyEl.value = settings.apiKey || '';
  targetLangEl.value = settings.targetLang;
  modeEl.value = settings.mode || 'legacy';

  function setStatus(msg, isErr) {
    statusEl.textContent = msg || '';
    statusEl.style.color = isErr ? '#ffb3b3' : '#8fd89f';
  }

  toggleEl.addEventListener('change', async () => {
    const enabled = toggleEl.checked;
    const patch = { enabled };
    if (enabled && (!modeEl.value || modeEl.value === 'off')) {
      modeEl.value = 'legacy';
      patch.mode = 'legacy';
    } else if (!enabled) {
      patch.mode = 'off';
    }
    await saveSettings(patch);
    setStatus(enabled ? '已开启' : '已关闭', false);
    try {
      await notifyTabSettings(patch);
    } catch (e) { /* tab 可能不存在 */ }
  });

  document.getElementById('save').addEventListener('click', async () => {
    const patch = {
      provider: providerEl.value,
      apiKey: apiKeyEl.value.trim(),
      targetLang: targetLangEl.value,
      mode: modeEl.value
    };
    if (patch.mode === 'off') patch.enabled = false;
    const p = PROVIDERS[patch.provider] || {};
    if (patch.provider !== 'custom') {
      patch.baseUrl = p.baseUrl;
      patch.model = p.model;
    }
    await saveSettings(patch);
    setStatus('已保存', false);
    await notifyTabSettings(patch);
  });

  document.getElementById('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  async function notifyTab(enabled) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id != null && tab.url && tab.url.includes('youtube.com')) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE', enabled });
      } catch (e) { /* ignore */ }
    }
  }

  async function notifyTabSettings(patch) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id != null && tab.url && tab.url.includes('youtube.com')) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', settings: patch });
      } catch (e) { /* ignore */ }
    }
  }
})();
