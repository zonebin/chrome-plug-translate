// x-article-translate.js — X 长文逐段英译中。
// 监听文章容器变化：识别英文段落，调用后台翻译引擎，
// 并把中文译文插入到对应英文段落下方。

(function () {
  'use strict';

  const ARTICLE_CONTAINER_SELECTOR = '[data-testid="twitterArticleRichTextView"]';
  const BLOCK_SELECTOR = [
    '[data-testid="twitterArticleRichTextView"] .longform-unstyled',
    '[data-testid="twitterArticleRichTextView"] .longform-header',
    '[data-testid="twitterArticleRichTextView"] .longform-blockquote'
  ].join(', ');

  const FLAG_ATTR = 'data-x-translate-text';
  const NODE_ATTR = 'data-x-translate-node';
  const NODE_CLASS = 'x-translate-node';
  const QUEUE_INTERVAL_MS = 220;
  const NODE_CHECK_INTERVAL_MS = 4000;
  const MAX_TEXT_LENGTH = 12000;
  const REQUEST_CHUNK_LENGTH = 1800;

  let settings = null;
  let watching = false;
  let nodeCheckTimer = null;
  let queueTimer = null;
  let inFlight = false;
  let blockIdCounter = 0;
  const pendingQueue = new Map();
  const translationCache = new Map();

  const observer = new MutationObserver(() => {
    if (!settings || !settings.xArticleAutoTranslate) return;
    scanArticle();
  });

  readSettings();

  function readSettings() {
    settings = { xArticleAutoTranslate: true };
    chrome.storage.local.get('settings').then((data) => {
      settings = Object.assign({ xArticleAutoTranslate: true }, data.settings || {});
      if (settings.xArticleAutoTranslate) {
        watchArticle();
      } else {
        teardown();
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    settings = Object.assign({}, settings || {}, changes.settings.newValue || {});
    if (settings.xArticleAutoTranslate) {
      watchArticle();
    } else {
      teardown();
    }
  });

  function watchArticle() {
    if (!watching) {
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true
      });
      watching = true;
    }
    if (!nodeCheckTimer) {
      nodeCheckTimer = setInterval(scanArticle, NODE_CHECK_INTERVAL_MS);
    }
    scanArticle();
  }

  function teardown() {
    if (watching) {
      observer.disconnect();
      watching = false;
    }
    if (nodeCheckTimer) {
      clearInterval(nodeCheckTimer);
      nodeCheckTimer = null;
    }
    if (queueTimer) {
      clearInterval(queueTimer);
      queueTimer = null;
    }
    pendingQueue.clear();
    inFlight = false;
    document.querySelectorAll('[' + NODE_ATTR + '="true"]').forEach((node) => node.remove());
  }

  function scanArticle() {
    if (!settings || !settings.xArticleAutoTranslate) return;
    const container = document.querySelector(ARTICLE_CONTAINER_SELECTOR);
    if (!container) return;

    const blocks = container.querySelectorAll(BLOCK_SELECTOR);
    for (const block of blocks) {
      if (!shouldTranslate(block)) continue;
      const text = (block.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > MAX_TEXT_LENGTH) continue;
      const changed = isTranslatedBlockChanged(block, text);
      if (block.hasAttribute(FLAG_ATTR) && !changed) continue;

      block.setAttribute(FLAG_ATTR, text);
      if (!block.dataset.xTranslateId) {
        blockIdCounter += 1;
        block.dataset.xTranslateId = 'xat-' + blockIdCounter;
      }
      pendingQueue.set(block.dataset.xTranslateId, { block, text });
    }
    scheduleFlush();
  }

  function shouldTranslate(block) {
    if (block.getAttribute('aria-hidden') === 'true') return false;
    if (block.closest('[aria-hidden="true"]')) return false;
    if (block.closest('[contenteditable="true"]')) return false;
    if (block.querySelector('[' + NODE_ATTR + '="true"]')) return false;
    return isEnglishText(block.textContent);
  }

  function isTranslatedBlockChanged(block, text) {
    if (!block.hasAttribute(FLAG_ATTR)) return false;
    return block.getAttribute(FLAG_ATTR) !== text;
  }

  function isEnglishText(text) {
    const value = (text || '').replace(/\s+/g, ' ').trim();
    if (value.length < 8) return false;

    const latinChars = (value.match(/[A-Za-z]/g) || []).length;
    if (latinChars / value.length < 0.7) return false;
    if (value.split(/\s+/).filter(Boolean).length < 5) return false;
    if (/[\u3400-\u4DBF\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/.test(value)) return false;
    return true;
  }

  function scheduleFlush() {
    if (queueTimer || !pendingQueue.size) return;
    queueTimer = setInterval(flushQueue, QUEUE_INTERVAL_MS);
  }

  function flushQueue() {
    if (inFlight) return;
    const next = pendingQueue.entries().next();
    if (next.done) {
      clearInterval(queueTimer);
      queueTimer = null;
      return;
    }

    const [blockId, item] = next.value;
    if (!item.block.isConnected) {
      pendingQueue.delete(blockId);
      return;
    }

    inFlight = true;
    translateArticleText(item.text).then((translated) => {
      pendingQueue.delete(blockId);
      inFlight = false;

      translationCache.set(item.text, translated);
      insertTranslation(item.block, translated);

      if (!pendingQueue.size) {
        clearInterval(queueTimer);
        queueTimer = null;
      }
    }).catch((error) => {
      pendingQueue.delete(blockId);
      inFlight = false;
      console.warn('[X 文章翻译]', error);

      if (!pendingQueue.size) {
        clearInterval(queueTimer);
        queueTimer = null;
      }
    });
  }

  async function translateArticleText(text) {
    if (translationCache.has(text)) {
      return translationCache.get(text);
    }
    if (text.length <= REQUEST_CHUNK_LENGTH) {
      return sendTranslateRequest(text);
    }

    const chunks = splitTranslationText(text, REQUEST_CHUNK_LENGTH);
    const translatedChunks = [];
    for (const chunk of chunks) {
      translatedChunks.push(await sendTranslateRequest(chunk));
    }
    return translatedChunks.join(' ');
  }

  function sendTranslateRequest(text) {
    return chrome.runtime.sendMessage({ type: 'TRANSLATE', text }).then((response) => {
      if (response && response.ok) return response.translated;
      throw new Error((response && response.error) || '翻译失败');
    });
  }

  function splitTranslationText(text, maxLength) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLength) {
      let cut = -1;
      for (let i = maxLength; i >= Math.floor(maxLength * 0.55); i--) {
        if (/[.!?。！？]\s/.test(remaining.slice(i - 1, i + 1))) {
          cut = i;
          break;
        }
      }
      if (cut < 0) cut = remaining.lastIndexOf(' ', maxLength);
      if (cut < Math.floor(maxLength * 0.4)) cut = maxLength;

      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks.filter(Boolean);
  }

  function insertTranslation(block, translated) {
    if (!block.isConnected) return;

    const previous = block.nextElementSibling;
    if (previous && previous.getAttribute(NODE_ATTR) === 'true') {
      previous.textContent = translated;
      return;
    }

    const node = document.createElement('p');
    node.setAttribute(NODE_ATTR, 'true');
    node.className = NODE_CLASS;
    node.textContent = translated;
    block.after(node);
  }
})();
