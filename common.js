// 共享常量与工具函数：被 background / content / popup / options 共同引用。

const DEFAULTS = {
  enabled: false,
  mode: 'off', // 'legacy'（经典模式）| 'learning'（学习模式）| 'off'
  provider: 'google', // 默认 Google 翻译（免费、无需 Key）。可选 'deepseek' | 'openai' | 'custom'
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

// 预置引擎模板，方便一键切换 provider 时更新 baseUrl / model。
const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  },
  google: {
    label: 'Google 翻译（免费，无需 Key）',
    baseUrl: 'https://translate.googleapis.com',
    model: ''
  },
  custom: {
    label: '自定义 (OpenAI 兼容)',
    baseUrl: '',
    model: ''
  }
};

// 常见目标语言（直接传给模型的自然语言名称，模型都能理解）。
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

async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  const stored = data.settings || {};
  const merged = Object.assign({}, DEFAULTS, stored);
  // 兜底：目标/源语言为空时回退到默认，避免翻译指令里目标语言缺失。
  if (!merged.targetLang) merged.targetLang = DEFAULTS.targetLang;
  if (!merged.sourceLang) merged.sourceLang = DEFAULTS.sourceLang;
  // 兜底：LLM 引擎（deepseek/openai/custom）未填 Key 时，自动回退到免费 Google 翻译。
  if (merged.provider !== 'google' && !merged.apiKey) {
    merged.provider = 'google';
    merged.baseUrl = PROVIDERS.google.baseUrl;
    merged.model = '';
  }
  // 一次性迁移：升级经典模式默认字号与颜色样式。
  const STYLE_REV = 3;
  if ((stored.styleRev || 0) < STYLE_REV) {
    merged.fontSize = DEFAULTS.fontSize;
    merged.originalColor = DEFAULTS.originalColor;
    merged.translationColor = DEFAULTS.translationColor;
    merged.backgroundOpacity = DEFAULTS.backgroundOpacity;
    merged.bottomOffset = DEFAULTS.bottomOffset;
    merged.styleRev = STYLE_REV;
    await chrome.storage.local.set({ settings: merged });
  }
  return merged;
}

async function saveSettings(patch) {
  const cur = await getSettings();
  const next = Object.assign({}, cur, patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}
