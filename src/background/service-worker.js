importScripts('../shared/config.js', './providers.js');

(function (root) {
  'use strict';

  const { getSettings } = root.YTSubConfig;
  const { translateSubtitle } = root.YTSubProviders;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === 'TRANSLATE') {
      (async () => {
        try {
          const settings = await getSettings();
          const translated = await translateSubtitle(message.text, settings);
          sendResponse({ ok: true, translated });
        } catch (err) {
          sendResponse({ ok: false, error: String((err && err.message) || err) });
        }
      })();
      return true;
    }

    if (message.type === 'TEST_TRANSLATE') {
      (async () => {
        try {
          const settings = await getSettings();
          if (settings.provider !== 'google' && !settings.apiKey) {
            throw new Error('请先填写 API Key');
          }
          const translated = await translateSubtitle(message.text || 'Hello, world!', settings);
          sendResponse({ ok: true, translated });
        } catch (err) {
          sendResponse({ ok: false, error: String((err && err.message) || err) });
        }
      })();
      return true;
    }

    return false;
  });

  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-translation') return;
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id != null) {
        await chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_REQUEST' });
      }
    } catch (_err) {}
  });
})(globalThis);
