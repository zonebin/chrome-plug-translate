// background.js — MV3 service worker。
// 职责：持有翻译逻辑，统一走 fetch 调用 OpenAI 兼容 /chat/completions 接口，
// 从而规避 content script 里的 CORS 限制，并集中处理密钥、模型、错误。

importScripts('common.js');

// 目标语言名 → Google 翻译语言代码（tl 参数）
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

function langToCode(lang) {
  return LANG_CODE_MAP[lang] || 'zh-CN';
}

// Google 翻译（免费，无需 Key）。返回翻译文本。
async function translateViaGoogle(text, targetLang) {
  const tl = langToCode(targetLang);
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
    encodeURIComponent(tl) + '&dt=t&q=' + encodeURIComponent(text);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Google 翻译请求失败 ' + resp.status);
  const data = await resp.json();
  // data[0] 是 [[translated, original, ...], ...] 结构
  let out = '';
  if (Array.isArray(data) && Array.isArray(data[0])) {
    for (const seg of data[0]) {
      if (seg && seg[0]) out += seg[0];
    }
  }
  if (!out) throw new Error('Google 翻译返回为空');
  return out.trim();
}

// 翻译一个文本片段。text 已是拼好的完整句子。
// 若 provider 是 google，直接走免费翻译；否则走 LLM，失败时降级到 Google。
async function translateOne(text, settings) {
  if (settings.provider === 'google') {
    return await translateViaGoogle(text, settings.targetLang);
  }

  const provider = PROVIDERS[settings.provider] || PROVIDERS.custom;
  let baseUrl = (settings.baseUrl || provider.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('未配置 API Base URL');
  const endpoint = baseUrl + '/chat/completions';

  const model = settings.model || provider.model;
  if (!model) throw new Error('未配置模型名称');

  const system =
    `You are a professional subtitle translator. Translate the user's subtitle text into ` +
    `${settings.targetLang}. Preserve meaning, tone and emphasis. ` +
    `Return ONLY the translated text with no quotes, no explanations, no notes. ` +
    `Keep line breaks and punctuation natural.`;

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text }
    ]
  };

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (settings.apiKey || '')
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error('翻译请求失败: ' + (e && e.message || e));
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    // 401/402/403/429（Key 无效/余额不足/限流）时，自动降级到 Google 免费翻译，
    // 并持久化切换到 google，避免后续每句都先失败再降级。
    if (resp.status === 401 || resp.status === 402 || resp.status === 403 || resp.status === 429) {
      try {
        await saveSettings({
          provider: 'google',
          baseUrl: PROVIDERS.google.baseUrl,
          model: ''
        });
      } catch (s) { /* 忽略保存失败 */ }
      try {
        return await translateViaGoogle(text, settings.targetLang);
      } catch (g) {
        throw new Error(`翻译接口错误 ${resp.status}（已尝试 Google 降级也失败）: ${errText.slice(0, 200)}`);
      }
    }
    throw new Error(`翻译接口错误 ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  const content = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('翻译接口返回格式异常');
  return String(content).trim();
}

// 处理来自 content script / popup 的消息。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'TRANSLATE') {
    (async () => {
      try {
        const settings = await getSettings();
        const translated = await translateOne(msg.text, settings);
        sendResponse({ ok: true, translated });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message || e) });
      }
    })();
    return true; // 异步响应
  }
  if (msg && msg.type === 'TEST_TRANSLATE') {
    (async () => {
      try {
        const settings = await getSettings();
        if (settings.provider !== 'google' && !settings.apiKey) throw new Error('请先填写 API Key');
        const translated = await translateOne(msg.text || 'Hello, world!', settings);
        sendResponse({ ok: true, translated });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message || e) });
      }
    })();
    return true;
  }
  return false;
});

// 快捷键 Alt+Shift+T：切换当前 YouTube 标签页的双语字幕开关。
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-translation') return;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || tab.id == null || !tab.url || !tab.url.includes('youtube.com')) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_REQUEST' });
    } catch (e) { /* content script 可能尚未注入 */ }
  } catch (e) { /* ignore */ }
});
