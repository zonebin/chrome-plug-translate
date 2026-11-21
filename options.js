// options.js — 完整设置页。

(async function () {
  const $ = (id) => document.getElementById(id);

  const els = {
    enabled: $('enabled'),
    mode: $('mode'),
    xArticleAuto: $('xArticleAuto'),
    provider: $('provider'),
    apiKey: $('apiKey'),
    baseUrl: $('baseUrl'),
    model: $('model'),
    targetLang: $('targetLang'),
    showOriginal: $('showOriginal'),
    showTranslation: $('showTranslation'),
    fontSize: $('fontSize'),
    fontSizeVal: $('fontSizeVal'),
    originalColor: $('originalColor'),
    translationColor: $('translationColor'),
    backgroundOpacity: $('backgroundOpacity'),
    backgroundOpacityVal: $('backgroundOpacityVal'),
    bottomOffset: $('bottomOffset')
  };

  LANGUAGES.forEach((l) => {
    const o = document.createElement('option');
    o.value = l; o.textContent = l;
    els.targetLang.appendChild(o);
  });

  const settings = await getSettings();

  els.enabled.checked = settings.enabled;
  els.mode.value = settings.mode || 'legacy';
  els.xArticleAuto.checked = settings.xArticleAutoTranslate !== false;
  els.provider.value = settings.provider;
  els.apiKey.value = settings.apiKey || '';
  els.baseUrl.value = settings.baseUrl || '';
  els.model.value = settings.model || '';
  els.targetLang.value = settings.targetLang;
  els.showOriginal.checked = settings.showOriginal;
  els.showTranslation.checked = settings.showTranslation;
  els.fontSize.value = settings.fontSize;
  els.originalColor.value = settings.originalColor;
  els.translationColor.value = settings.translationColor;
  els.backgroundOpacity.value = Math.round(settings.backgroundOpacity * 100);
  els.bottomOffset.value = settings.bottomOffset;

  syncSliders();

  function syncSliders() {
    els.fontSizeVal.textContent = els.fontSize.value + 'px';
    els.backgroundOpacityVal.textContent = els.backgroundOpacity.value + '%';
  }
  els.fontSize.addEventListener('input', syncSliders);
  els.backgroundOpacity.addEventListener('input', syncSliders);

  // 切换引擎时自动套用预置 baseUrl / model（仅当用户未手动改过 custom）
  els.provider.addEventListener('change', () => {
    const p = PROVIDERS[els.provider.value];
    if (p && els.provider.value !== 'custom') {
      els.baseUrl.value = p.baseUrl;
      els.model.value = p.model;
    }
  });

  function collect() {
    const patch = {
      enabled: els.enabled.checked,
      mode: els.mode.value,
      xArticleAutoTranslate: els.xArticleAuto.checked,
      provider: els.provider.value,
      apiKey: els.apiKey.value.trim(),
      baseUrl: els.baseUrl.value.trim(),
      model: els.model.value.trim(),
      targetLang: els.targetLang.value,
      showOriginal: els.showOriginal.checked,
      showTranslation: els.showTranslation.checked,
      fontSize: parseInt(els.fontSize.value, 10),
      originalColor: els.originalColor.value,
      translationColor: els.translationColor.value,
      backgroundOpacity: parseInt(els.backgroundOpacity.value, 10) / 100,
      bottomOffset: parseInt(els.bottomOffset.value, 10) || 8
    };
    if (patch.mode === 'off') patch.enabled = false;
    if (patch.provider !== 'custom') {
      const p = PROVIDERS[patch.provider];
      patch.baseUrl = p.baseUrl;
      patch.model = p.model;
    }
    return patch;
  }

  const savedEl = $('saved');
  $('save').addEventListener('click', async () => {
    const patch = collect();
    await saveSettings(patch);
    savedEl.textContent = '已保存 ✓';
    setTimeout(() => { savedEl.textContent = ''; }, 2000);
    notifyTabs(patch);
  });

  const testResultEl = $('testResult');
  $('test').addEventListener('click', async () => {
    // 先保存，测试使用最新配置
    const patch = collect();
    await saveSettings(patch);
    testResultEl.textContent = '测试中…';
    testResultEl.style.color = '#9a9a9a';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'TEST_TRANSLATE', text: 'Hello, how are you doing today?' });
      if (resp && resp.ok) {
        testResultEl.textContent = '成功: ' + resp.translated;
        testResultEl.style.color = '#8fd89f';
      } else {
        testResultEl.textContent = '失败: ' + (resp && resp.error || '未知错误');
        testResultEl.style.color = '#ffb3b3';
      }
    } catch (e) {
      testResultEl.textContent = '失败: ' + String(e);
      testResultEl.style.color = '#ffb3b3';
    }
  });

  async function notifyTabs(patch) {
    try {
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        if (t.id != null && t.url && t.url.includes('youtube.com')) {
          chrome.tabs.sendMessage(t.id, { type: 'SETTINGS_UPDATED', settings: patch }).catch(() => {});
        }
      }
    } catch (e) { /* ignore */ }
  }
})();
