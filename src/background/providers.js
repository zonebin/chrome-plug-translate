(function (root) {
  'use strict';

  const { PROVIDERS, saveSettings, langToCode } = root.YTSubConfig;

  const providerRegistry = new Map();

  function registerProvider(name, adapter) {
    providerRegistry.set(name, adapter);
  }

  async function translateViaGoogle(text, settings) {
    const targetCode = langToCode(settings.targetLang);
    const endpoint =
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
      encodeURIComponent(targetCode) +
      '&dt=t&q=' +
      encodeURIComponent(text);

    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error('Google 翻译请求失败 ' + response.status);
    }
    const payload = await response.json();
    let output = '';
    if (Array.isArray(payload) && Array.isArray(payload[0])) {
      for (const segment of payload[0]) {
        if (segment && segment[0]) output += segment[0];
      }
    }
    if (!output) {
      throw new Error('Google 翻译返回为空');
    }
    return output.trim();
  }

  async function translateViaOpenAICompatible(text, settings) {
    const preset = PROVIDERS[settings.provider] || PROVIDERS.custom;
    const baseUrl = (settings.baseUrl || preset.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) {
      throw new Error('未配置 API Base URL');
    }
    const model = settings.model || preset.model;
    if (!model) {
      throw new Error('未配置模型名称');
    }

    const systemPrompt =
      'You are a professional subtitle translator. Translate the user\'s subtitle text into ' +
      settings.targetLang +
      '. Preserve meaning, tone and emphasis. ' +
      'Return ONLY the translated text with no quotes, no explanations, no notes. ' +
      'Keep line breaks and punctuation natural.';

    let response;
    try {
      response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (settings.apiKey || '')
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ]
        })
      });
    } catch (err) {
      throw new Error('翻译请求失败: ' + ((err && err.message) || err));
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const recoverableStatus =
        response.status === 401 ||
        response.status === 402 ||
        response.status === 403 ||
        response.status === 429;

      if (recoverableStatus) {
        try {
          await saveSettings({
            provider: 'google',
            baseUrl: PROVIDERS.google.baseUrl,
            model: ''
          });
        } catch (_saveErr) {}
        try {
          return await translateViaGoogle(text, settings);
        } catch (_fallbackErr) {
          throw new Error(
            '翻译接口错误 ' + response.status + '（Google 免费翻译降级亦失败）: ' + errorText.slice(0, 200)
          );
        }
      }
      throw new Error('翻译接口错误 ' + response.status + ': ' + errorText.slice(0, 300));
    }

    const data = await response.json();
    const content =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    if (!content) {
      throw new Error('翻译接口返回格式异常');
    }
    return String(content).trim();
  }

  registerProvider('google', { translate: translateViaGoogle });
  registerProvider('deepseek', { translate: translateViaOpenAICompatible });
  registerProvider('openai', { translate: translateViaOpenAICompatible });
  registerProvider('custom', { translate: translateViaOpenAICompatible });

  async function translateSubtitle(text, settings) {
    if (settings.provider === 'google' || !settings.apiKey) {
      return translateViaGoogle(text, settings);
    }
    const adapter = providerRegistry.get(settings.provider) || providerRegistry.get('custom');
    return adapter.translate(text, settings);
  }

  root.YTSubProviders = {
    registerProvider,
    translateSubtitle,
    translateViaGoogle,
    translateViaOpenAICompatible
  };
})(globalThis);
