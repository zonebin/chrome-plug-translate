// page-bridge.js — 注入主世界（MAIN world）。
// 字幕拦截方案：
//   1. hook XMLHttpRequest.prototype.open 记录 /api/timedtext 请求
//   2. hook XHR onload 缓存播放器自己拉到的 json3 字幕响应（timedtextRaw）
//   3. 提供 toggleSubtitles() nudge：让 YouTube 播放器自己请求字幕
//   4. 通过 postMessage 与 content script（isolated world）互通
(function () {
  'use strict';
  if (window.__dshYTBridge) return;
  window.__dshYTBridge = true;

  // ------- 播放器响应读取 -------
  function getPlayerResponse() {
    try {
      const el = document.querySelector('#movie_player');
      if (el && el.getPlayerResponse) {
        const pr = el.getPlayerResponse();
        if (pr && pr.captions) return pr;
      }
    } catch (e) {}
    try {
      const flexy = document.querySelector('ytd-watch-flexy');
      if (flexy && flexy.playerData && flexy.playerData.captions) return flexy.playerData;
      if (flexy && flexy.playerResponse && flexy.playerResponse.captions) return flexy.playerResponse;
    } catch (e) {}
    try {
      if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.captions) {
        return window.ytInitialPlayerResponse;
      }
    } catch (e) {}
    return null;
  }

  function currentVideoId() {
    try {
      const u = new URL(location.href);
      if (u.pathname.startsWith('/watch')) return u.searchParams.get('v');
      if (u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/embed/')) {
        return u.pathname.split('/')[2] || null;
      }
    } catch (e) {}
    return null;
  }

  // ------- 轨道列表 -------
  function extractTracks() {
    const pr = getPlayerResponse();
    const result = { tracks: [], title: '' };
    if (!pr) return result;
    try {
      result.title = (pr.videoDetails && pr.videoDetails.title) || '';
      const list = (pr.captions.playerCaptionsTracklistRenderer || {}).captionTracks || [];
      for (const t of list) {
        result.tracks.push({
          baseUrl: t.baseUrl || '',
          name: (t.name && (t.name.simpleText || (t.name.runs || []).map(r => r.text).join(''))) || '',
          vssId: t.vssId || '',
          languageCode: t.languageCode || '',
          kind: t.kind || ''
        });
      }
    } catch (e) {}
    return result;
  }

  // ------- XHR hook（字幕拦截核心）-------
  const timedtextRaw = {};    // responseURL -> json3 文本（最多 8 条）
  const timedtextInflight = new Map(); // responseURL -> 时间戳
  const rejectedURLs = new Set();

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    const a = String(url);
    if (/api\/timedtext/.test(a)) {
      const full = /^https?:/.test(a) ? a : location.origin + a;
      timedtextInflight.set(full, Date.now());
      this.addEventListener('loadend', () => timedtextInflight.delete(full), { once: true });
    }
    return origOpen.apply(this, [method, url]);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this.__dshTimedTextWired) return origSend.apply(this, arguments);
    // 给所有 XHR 挂 load 监听（仅 timedtext 生效）
    const self = this;
    const origOnLoadProp = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'onload');
    this.addEventListener('load', function (ev) {
      try {
        const url = ev.currentTarget.responseURL || '';
        if (url.indexOf('/api/timedtext') < 0) return;
        const u = new URL(url);
        const vid = u.searchParams.get('v');
        if (vid) {
          bridgeState.contextURLs[vid] = bridgeState.contextURLs[vid] || [];
          if (bridgeState.contextURLs[vid][0] !== url) bridgeState.contextURLs[vid].unshift(url);
        }
        if (u.searchParams.get('fmt') === 'json3') {
          let body = '';
          try {
            body = typeof self.response === 'string' ? self.response
              : self.response ? JSON.stringify(self.response)
              : self.responseText || '';
          } catch (e) {}
          if (body && /^\s*\{/.test(body) && body.indexOf('"events"') >= 0) {
            timedtextRaw[url] = body;
            const keys = Object.keys(timedtextRaw);
            if (keys.length > 8) delete timedtextRaw[keys[0]];
            notifySubtitlesReady(url);
          } else if (!body) {
            // 空响应：YouTube 拒绝了这次请求
            rejectedURLs.add(url);
            window.postMessage({ __dshYTRejected: { url } }, '*');
          }
        }
      } catch (e) {}
    });
    this.__dshTimedTextWired = true;
    return origSend.apply(this, arguments);
  };

  function notifySubtitlesReady(url) {
    window.postMessage({ __dshYTSubtitleLoaded: { url } }, '*');
  }

  const bridgeState = { contextURLs: {} };

  // ------- 从拦截缓存查字幕 -------
  function findIntercepted(targetUrl) {
    try {
      const u = new URL(targetUrl);
      const vid = u.searchParams.get('v') || currentVideoId();
      const lang = u.searchParams.get('lang') || '';
      const kind = u.searchParams.get('kind') || '';
      const tlang = u.searchParams.get('tlang') || '';
      const candidates = bridgeState.contextURLs[vid] || [];
      for (const cu of candidates) {
        const raw = timedtextRaw[cu];
        if (!raw) continue;
        try {
          const c = new URL(cu);
          if (c.searchParams.get('fmt') !== 'json3') continue;
          if ((c.searchParams.get('lang') || '') !== lang) continue;
          if ((c.searchParams.get('kind') || '') !== kind) continue;
          if ((c.searchParams.get('tlang') || '') !== tlang) continue;
          return JSON.parse(raw);
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  // 供 content script 拉取全部拦截缓存（带元数据）
  function dumpIntercepted() {
    const out = [];
    for (const url in timedtextRaw) {
      try {
        const u = new URL(url);
        out.push({
          url,
          v: u.searchParams.get('v'),
          lang: u.searchParams.get('lang') || '',
          kind: u.searchParams.get('kind') || '',
          tlang: u.searchParams.get('tlang') || '',
          raw: timedtextRaw[url]
        });
      } catch (e) {}
    }
    return out;
  }

  // 从最近 inflight URL 借 POT token
  function borrowPot(targetUrl) {
    try {
      const u = new URL(targetUrl);
      for (const [inf, ts] of timedtextInflight) {
        if (Date.now() - ts > 120000) continue;
        try {
          const c = new URL(inf);
          if (c.searchParams.get('pot')) {
            u.searchParams.set('pot', c.searchParams.get('pot'));
            const potc = c.searchParams.get('potc');
            if (potc) u.searchParams.set('potc', potc);
            return u.toString();
          }
        } catch (e) {}
      }
    } catch (e) {}
    return targetUrl;
  }

  // ------- nudge：调用播放器的 toggleSubtitles 请求字幕 -------
  function nudgePlayer() {
    // 优先检查 CC 按钮当前状态
    try {
      const btn = document.querySelector('.ytp-subtitles-button');
      if (btn) {
        const pressed = btn.getAttribute('aria-pressed') === 'true';
        if (!pressed) {
          // 未开：直接点开，播放器会发起 timedtext 请求
          btn.click();
          return { ok: true, via: 'cc-button' };
        }
        // 已开：先关再开，强制播放器重新拉取字幕（这样才能被 XHR hook 拦截到）
        btn.click();
        setTimeout(() => { try { btn.click(); } catch (e) {} }, 400);
        return { ok: true, via: 'cc-button-retrigger' };
      }
    } catch (e) {}
    // 兜底：调用播放器 toggleSubtitles
    try {
      const el = document.querySelector('#movie_player');
      if (el && el.toggleSubtitles) {
        el.toggleSubtitles();
        return { ok: true, via: 'toggleSubtitles' };
      }
    } catch (e) {}
    return { ok: false };
  }

  function ensureSubtitlesOn() {
    // 确保播放器 CC 是开着的（只开不关）
    try {
      const btn = document.querySelector('.ytp-subtitles-button');
      if (btn && btn.getAttribute('aria-pressed') !== 'true') {
        btn.click();
        return true;
      }
    } catch (e) {}
    return false;
  }

  // ------- 消息接口 -------
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || !d.__dshYTRequest) return;
    const type = d.__dshYTRequest;

    if (type === 'captions') {
      const r = extractTracks();
      const vid = currentVideoId();
      window.postMessage({
        __dshYTCaptions: { videoId: vid, tracks: r.tracks, title: r.title }
      }, '*');
    } else if (type === 'findIntercepted') {
      const j = findIntercepted(d.url);
      window.postMessage({
        __dshYTFindResult: { url: d.url, videoId: d.videoId, found: !!j, corpus: j || null }
      }, '*');
    } else if (type === 'dumpIntercepted') {
      const dump = dumpIntercepted();
      window.postMessage({
        __dshYTDump: { videoId: d.videoId, items: dump }
      }, '*');
    } else if (type === 'borrowPot') {
      const url = borrowPot(d.url);
      window.postMessage({
        __dshYTPot: { videoId: d.videoId, url }
      }, '*');
    } else if (type === 'nudge') {
      const r = nudgePlayer();
      window.postMessage({
        __dshYTNudge: { videoId: d.videoId, result: r }
      }, '*');
    } else if (type === 'ensureSubtitlesOn') {
      const ok = ensureSubtitlesOn();
      window.postMessage({
        __dshYTEnsure: { videoId: d.videoId, ok }
      }, '*');
    }
  });

  // 就绪通知
  window.postMessage({ __dshYTBridgeReady: true }, '*');
})();
