(function (root) {
  'use strict';

  const DEFAULTS = {
    enabled: false,
    mode: 'off',
    provider: 'google',
    apiKey: '',
    baseUrl: 'https://translate.googleapis.com',
    model: '',
    targetLang: '简体中文',
    sourceLang: 'auto',
    showOriginal: true,
    showTranslation: true,
    fontSize: 21,
    originalColor: '#e8e8e8',
    translationColor: '#9a9a9a',
    backgroundOpacity: 0.97,
    bottomOffset: 8
  };

  const PROVIDERS = {
    deepseek: {
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      requiresKey: true
    },
    openai: {
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      requiresKey: true
    },
    google: {
      label: 'Google 翻译（免费，无需 Key）',
      baseUrl: 'https://translate.googleapis.com',
      model: '',
      requiresKey: false
    },
    custom: {
      label: '自定义 (OpenAI 兼容)',
      baseUrl: '',
      model: '',
      requiresKey: true
    }
  };

  const LANGUAGES = [
    '简体中文',
    '繁體中文',
    'English',
    '日本語',
    '한국어',
    'Español',
    'Français',
    'Deutsch',
    'Русский',
    'Português',
    'Italiano',
    'العربية',
    'हिन्दी',
    'ไทย',
    'Tiếng Việt',
    'Bahasa Indonesia'
  ];

  const LANG_CODE_MAP = {
    '简体中文': 'zh-CN',
    '繁體中文': 'zh-TW',
    'English': 'en',
    '日本語': 'ja',
    '한국어': 'ko',
    'Español': 'es',
    'Français': 'fr',
    'Deutsch': 'de',
    'Русский': 'ru',
    'Português': 'pt',
    'Italiano': 'it',
    'العربية': 'ar',
    'हिन्दी': 'hi',
    'ไทย': 'th',
    'Tiếng Việt': 'vi',
    'Bahasa Indonesia': 'id'
  };

  const CURRENT_STYLE_REVISION = 3;

  async function getSettings() {
    const data = await chrome.storage.local.get('settings');
    const stored = data.settings || {};
    const merged = Object.assign({}, DEFAULTS, stored);

    if (!merged.targetLang) merged.targetLang = DEFAULTS.targetLang;
    if (!merged.sourceLang) merged.sourceLang = DEFAULTS.sourceLang;

    if (merged.provider !== 'google' && !merged.apiKey) {
      merged.provider = 'google';
      merged.baseUrl = PROVIDERS.google.baseUrl;
      merged.model = '';
    }

    if ((stored.styleRev || 0) < CURRENT_STYLE_REVISION) {
      merged.fontSize = DEFAULTS.fontSize;
      merged.originalColor = DEFAULTS.originalColor;
      merged.translationColor = DEFAULTS.translationColor;
      merged.backgroundOpacity = DEFAULTS.backgroundOpacity;
      merged.bottomOffset = DEFAULTS.bottomOffset;
      merged.styleRev = CURRENT_STYLE_REVISION;
      await chrome.storage.local.set({ settings: merged });
    }
    return merged;
  }

  async function saveSettings(patch) {
    const current = await getSettings();
    const next = Object.assign({}, current, patch);
    await chrome.storage.local.set({ settings: next });
    return next;
  }

  function langToCode(langName) {
    return LANG_CODE_MAP[langName] || 'zh-CN';
  }

  root.YTSubConfig = {
    DEFAULTS,
    PROVIDERS,
    LANGUAGES,
    LANG_CODE_MAP,
    getSettings,
    saveSettings,
    langToCode
  };
})(globalThis);
