// content.js — YouTube 双语字幕引擎（MV3 isolated world）。
// 字幕获取采用三层策略（参考 youtube-transcript-minimal 的验证方案）：
//   Path 1: timedtext 原样 baseUrl（XML）/ fmt=json3
//   Path 2: innertube get_transcript API（带 visitor/identity 头）
//   Path 3: 驱动 YouTube「显示转录稿」面板，抓取渲染结果
// 之后：碎片 cue 合并成整句 → AI 翻译（走 background）→ 双语 overlay。

(function () {
  'use strict';
  if (window.__dshYtSubLoaded) return;
  window.__dshYtSubLoaded = true;

  let settings = null;
  let enabled = false;
  let currentVideoId = null;
  let lastHtml = null; // 最近一次 refetch 的 watch 页 HTML（供 transcript API 复用）

  let cues = [];        // {start, end, text, words?: [{text,start,end}]}
  let sentences = [];   // {start, end, text, key, words: [{text,start,end}]}
  let transCache = new Map();
  let translating = new Set();

  let rafId = null;
  let lastActiveKey = null;
  let bridgeInjected = false;
  let failedKeys = new Set();
  let cooldownUntil = 0;
  let acquiring = false;
  let lastTranslateError = '';

  let overlayEl = null, listEl = null, headTitleEl = null;
  let itemEls = [];      // 每条句子的 DOM 元素
  let diagEl = null, diagHideTimer = null;
  let mode = 'legacy';   // 'legacy'（经典模式）| 'learning'（学习模式）| 'off'
  let bottomEl = null, bottomOrigEl = null, bottomTransEl = null;
  let stageEl = null, legacyViewEl = null, learningViewEl = null;
  let legacySubAreaEl = null, learnSubAreaEl = null;
  let legacySlotEl = null, learnSlotEl = null, learnVidStage = null, captionHostEl = null, slotResizeObs = null;
  let legacyCtlEl = null, legacyTimelineFillEl = null, legacyTimeFloatEl = null;
  let legacyThumbEl = null, legacyTitleEl = null;
  let legacyPlayEl = null, legacyAutoEl = null, legacyRepeatEl = null, legacySpeedBtnEl = null;
  let learnCtlEl = null, learnSidebarEl = null, learnListEl = null, learnTabCountEl = null;
  let learnAuraEl = null, learnNavTitleEl = null, learnNavChannelEl = null, learnEngineEl = null;
  let learnProgFillEl = null, learnProgScrubEl = null, learnTimeEl = null;
  let learnPlayEl = null, learnAutoEl = null, learnRepeatEl = null, learnMuteEl = null;
  let learnSpeedBtnEl = null, learnIdxEl = null;
  let speedPanelEl = null, speedSliderEl = null, speedValueEl = null;
  let lastSyncedMp = null;
  let lastSlotRectKey = '';
  let pendingStageSync = false;
  let originalScrollY = 0;
  let learnRate = 1;
  let repeatOn = false;
  let repeatIdx = -1;
  let autoPause = false;
  let autoPausedKey = null;
  let lastPlayTime = -1;
  let lastPlayIdx = -1;
  let lastRenderKey = null;
  let wordEls = [];            // 学习模式逐词 token
  let wordTimes = [];          // 学习模式逐词起止时间

  function videoEl() {
    return (
      document.querySelector('#movie_player video.html5-main-video') ||
      document.querySelector('#movie_player video') ||
      document.querySelector('video.html5-main-video') ||
      document.querySelector('video')
    );
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function makeSvg(viewBox, size, paths) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'currentColor');
    for (const def of paths) {
      const p = document.createElementNS(SVG_NS, 'path');
      if (typeof def === 'string') {
        p.setAttribute('d', def);
      } else {
        for (const k in def) p.setAttribute(k, def[k]);
      }
      svg.appendChild(p);
    }
    return svg;
  }

  const ICONS = {
    brand: 'M2.26981 3.3543C2.49747 3.08644 2.80895 2.99474 3.0825 3.00023C4.04646 3.0195 6.89828 3.35796 10.113 4.63373C11.8224 4.03793 14.0853 3.55535 16.8303 3.526C17.4822 3.51903 18 4.05545 18 4.70159V10.8281C18 11.4858 17.4752 12.0003 16.8485 12.0121C15.9601 12.0288 14.9544 12.1145 14.1241 12.2113V14.9603C14.1241 15.0724 14.1102 15.1987 14.0706 15.3292C13.7792 16.2894 13.0493 16.9508 12.2382 17.3637C11.4256 17.7775 10.4644 17.9804 9.55306 17.9986C8.64761 18.0168 7.71703 17.8538 6.98212 17.4604C6.23348 17.0596 5.60439 16.3595 5.60439 15.3428V15.339L5.63937 11.7304C5.44415 11.6614 5.19389 11.5813 4.91526 11.4999C4.2171 11.2958 3.42754 11.1084 2.95856 11.0582C2.47548 11.0065 2.01845 10.6037 2.01088 10.0191C1.98858 8.29598 2.00645 5.08082 2.01277 4.09242C2.0141 3.88666 2.06169 3.59918 2.26981 3.3543ZM7.17098 11.2332L7.15542 12.8654C8.43327 11.8278 10.4426 11.1551 13.2565 10.7627C14.1141 10.6431 15.3426 10.5148 16.473 10.4747V5.0801C13.9265 5.14874 11.8658 5.63148 10.3578 6.18703C8.81528 6.75533 7.80923 7.48847 7.32084 8.00885C7.21419 8.12248 7.13535 8.33217 7.1396 8.67776L7.17098 11.2332ZM7.20812 15.2532C7.15751 15.3745 7.13846 15.5122 7.19502 15.6309C7.27198 15.7925 7.42598 15.9482 7.69541 16.0924C8.13611 16.3283 8.79056 16.4665 9.52289 16.4518C10.2493 16.4372 10.9787 16.2735 11.5525 15.9813C12.0295 15.7385 12.3534 15.4331 12.5245 15.0909C12.5803 14.9795 12.5972 14.854 12.5972 14.7294V12.4303C9.11285 13.0326 7.70422 14.0632 7.20812 15.2532ZM5.62999 10.101L5.61276 8.697C5.60612 8.15644 5.71821 7.4713 6.21428 6.94271C6.63293 6.49665 7.25541 6.0036 8.07195 5.54282C6.11249 4.91405 4.44095 4.65652 3.53687 4.57637C3.53018 5.76394 3.52035 8.05492 3.53329 9.5791C4.09274 9.6758 4.7712 9.84755 5.33843 10.0133C5.43781 10.0424 5.5354 10.0717 5.62999 10.101Z',
    play: 'M8 5.14v14l11-7-11-7z',
    pause: 'M6 5h4v14H6V5zm8 0h4v14h-4V5z',
    prev: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
    next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
    autoPause: 'M4 16a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1zm4 0a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1zM16 2.61c0-.49.6-.78 1.04-.5l3.68 2.39a.59.59 0 0 1 0 1l-3.68 2.39c-.44.28-1.04-.01-1.04-.5V2.61zM3 7a3 3 0 0 1 3-3h6a1 1 0 1 1 0 2H6a1 1 0 0 0-1 1v4a1 1 0 1 1-2 0V7zm17 6a1 1 0 0 1 1 1v4.5a3 3 0 0 1-3 3h-6a1 1 0 1 1 0-2h6a1 1 0 0 0 1-1V14a1 1 0 0 1 1-1z',
    close: 'M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z',
    back: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
    fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
    sidebar: 'M3 4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4zm12 0v16h4V4h-4zm-2 0H5v16h8V4z',
    volumeOn: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z',
    volumeOff: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
    modeSwitch: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v10h10V7H4zm12 0v10h4V7h-4z',
    learnIcon: 'M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z'
  };

  /* ---------------- 诊断状态条 ---------------- */
  function diag(msg, sticky) {
    if (!diagEl) {
      diagEl = document.createElement('div');
      diagEl.id = 'dsh-diag';
      diagEl.style.cssText =
        'position:fixed;bottom:92px;left:24px;z-index:2147483647;' +
        'background:rgba(18,18,22,0.9);color:rgba(255,255,255,0.88);font:12px/1.45 system-ui,sans-serif;' +
        'border:1px solid rgba(255,255,255,0.12);padding:6px 12px;border-radius:8px;' +
        'max-width:48vw;white-space:pre-wrap;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,0.35);';
      (document.body || document.documentElement).appendChild(diagEl);
    }
    diagEl.textContent = '[双语字幕] ' + msg;
    diagEl.style.display = 'block';
    clearTimeout(diagHideTimer);
    if (!sticky) diagHideTimer = setTimeout(() => { if (diagEl) diagEl.style.display = 'none'; }, 2400);
  }
  function diagKeep() { clearTimeout(diagHideTimer); }

  /* ---------------- 播放器下方入口按钮 + 模式菜单 ---------------- */
  let translateBtnEl = null, modeMenuEl = null, mountTimer = null;
  let stageModeBtnEl = null, stageModeLabelEl = null;

  function refreshTranslateButton() {
    if (!translateBtnEl) return;
    translateBtnEl.classList.toggle('on', !!enabled);
    if (stageModeBtnEl) {
      stageModeBtnEl.style.display = enabled ? 'inline-flex' : 'none';
    }
    if (stageModeLabelEl) {
      stageModeLabelEl.textContent = mode === 'learning' ? '学习模式' : '经典模式';
    }
    if (!modeMenuEl) return;
    modeMenuEl.querySelectorAll('.dsh-menu-item').forEach((it) => {
      it.classList.toggle('on', it.dataset.mode === mode);
    });
  }

  function applyMode(m) {
    mode = m;
    enabled = m !== 'off';
    autoPausedKey = null;
    clearPlayerSlotRect();
    if (!enabled) repeatOn = false;
    settings = Object.assign({}, settings || {}, { mode: m, enabled });
    saveSettings({ mode: m, enabled });
    if (modeMenuEl) modeMenuEl.style.display = 'none';
    if (speedPanelEl) speedPanelEl.style.display = 'none';
    if (!isVideoPage()) {
      hideVideoChrome();
      refreshTranslateButton();
      return;
    }
    setStageMode(m);
    if (enabled) {
      if (!sentences.length) acquireAndLoad();
      start();
      if (sentences.length) {
        buildList();
        lastRenderKey = null;
        lastActiveKey = null;
        const curIdx = Math.max(0, currentSentenceIndex());
        updateBottom(curIdx);
        highlightActive(curIdx);
      }
    } else {
      stop();
    }
    refreshTranslateButton();
  }

  function ensureModeMenu() {
    if (modeMenuEl) return;
    modeMenuEl = document.createElement('div');
    modeMenuEl.className = 'dsh-mode-menu';
    modeMenuEl.style.display = 'none';
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick'].forEach((evName) => {
      modeMenuEl.addEventListener(evName, (e) => e.stopPropagation());
    });
    const mk = (title, desc, m, iconPath) => {
      const d = document.createElement('div');
      d.className = 'dsh-menu-item';
      d.dataset.mode = m;
      const ic = document.createElement('div');
      ic.className = 'dsh-menu-item-icon';
      ic.appendChild(makeSvg('0 0 24 24', 18, [iconPath]));
      const txt = document.createElement('div');
      txt.className = 'dsh-menu-item-text';
      const tEl = document.createElement('div');
      tEl.className = 'dsh-menu-item-title';
      tEl.textContent = title;
      txt.appendChild(tEl);
      if (desc) {
        const dEl = document.createElement('div');
        dEl.className = 'dsh-menu-item-desc';
        dEl.textContent = desc;
        txt.appendChild(dEl);
      }
      d.append(ic, txt);
      d.addEventListener('click', (e) => { e.stopPropagation(); applyMode(m); });
      modeMenuEl.appendChild(d);
    };
    mk('学习模式', '整句字幕 · 句末暂停 · 沉浸练习', 'learning', ICONS.learnIcon);
    mk('经典模式', '双栏字幕 · 底部大字 · 金色高亮', 'legacy', ICONS.modeSwitch);
    const sep = document.createElement('div');
    sep.className = 'dsh-menu-sep';
    modeMenuEl.appendChild(sep);
    mk('关闭翻译', '退出当前翻译视图', 'off', ICONS.close);
    (document.body || document.documentElement).appendChild(modeMenuEl);
  }

  function showModeMenu(anchor) {
    if (!modeMenuEl) ensureModeMenu();
    if (!modeMenuEl || !anchor) return;
    const r = anchor.getBoundingClientRect();
    modeMenuEl.style.visibility = 'hidden';
    modeMenuEl.style.display = 'block';
    const mw = modeMenuEl.offsetWidth || 256;
    const mh = modeMenuEl.offsetHeight || 176;
    modeMenuEl.style.position = 'fixed';
    modeMenuEl.style.bottom = 'auto';
    modeMenuEl.style.top = Math.round(Math.min(window.innerHeight - mh - 8, r.bottom + 8)) + 'px';
    modeMenuEl.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))) + 'px';
    modeMenuEl.style.visibility = '';
  }

  function ensureStageModeButton() {
    if (stageModeBtnEl) return stageModeBtnEl;
    stageModeBtnEl = document.createElement('button');
    stageModeBtnEl.id = 'dsh-stage-mode-btn';
    stageModeBtnEl.type = 'button';
    stageModeBtnEl.className = 'dsh-stage-mode-btn';
    stageModeBtnEl.title = '切换翻译模式';
    stageModeBtnEl.appendChild(makeSvg('0 0 24 24', 15, [ICONS.modeSwitch]));
    stageModeLabelEl = document.createElement('span');
    stageModeLabelEl.textContent = '经典模式';
    stageModeBtnEl.appendChild(stageModeLabelEl);
    stageModeBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      showModeMenu(stageModeBtnEl);
    });
    return stageModeBtnEl;
  }

  function mountTranslateButton() {
    const fullscreen = document.querySelector('.ytp-fullscreen-button');
    const host = fullscreen && fullscreen.parentElement;
    if (translateBtnEl && translateBtnEl.isConnected) {
      if (!translateBtnEl.classList.contains('in-stage') && fullscreen && host && !host.contains(translateBtnEl)) {
        fullscreen.after(translateBtnEl);
        refreshTranslateButton();
      }
      return true;
    }

    translateBtnEl = document.createElement('div');
    translateBtnEl.id = 'dsh-translate-btn';
    translateBtnEl.className = 'dsh-translate-btn';
    translateBtnEl.dataset.build = '20261118.22';
    const inner = document.createElement('div');
    inner.className = 'dsh-translate-btn-inner';
    const logo = document.createElement('img');
    logo.className = 'dsh-translate-logo';
    logo.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">' +
      '<rect width="48" height="48" rx="13" fill="#22bd5c"/>' +
      '<path fill="#fff" d="M12 12h24v6H30v20h-12V18h-6z"/></svg>'
    );
    logo.alt = '双语字幕';
    logo.draggable = false;
    inner.appendChild(logo);
    translateBtnEl.appendChild(inner);

    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick'].forEach((evName) => {
      translateBtnEl.addEventListener(evName, (e) => e.stopPropagation());
    });
    translateBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = modeMenuEl && modeMenuEl.style.display !== 'none';
      if (open) { modeMenuEl.style.display = 'none'; return; }
      showModeMenu(translateBtnEl);
    });

    if (fullscreen && host) {
      fullscreen.after(translateBtnEl);
    } else {
      const meta = document.querySelector('ytd-watch-metadata');
      const title = meta && (meta.querySelector('#title') || meta.querySelector('h1'));
      const fallback = title || (meta && meta.firstElementChild);
      if (!fallback) return false;
      fallback.after(translateBtnEl);
    }
    ensureModeMenu();
    ensureStageModeButton();
    refreshTranslateButton();
    return true;
  }

  function scheduleMount() {
    if (!isVideoPage()) {
      hideVideoChrome();
      return;
    }
    mountTranslateButton();
    if (mountTimer) return;
    mountTimer = setInterval(() => { mountTranslateButton(); }, 1000);
  }

  function hideVideoChrome() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (mountTimer) { clearInterval(mountTimer); mountTimer = null; }
    if (slotResizeObs) { slotResizeObs.disconnect(); slotResizeObs = null; }
    restorePageLayout();
    [translateBtnEl, modeMenuEl, stageModeBtnEl, stageEl, bottomEl, diagEl, speedPanelEl].forEach((el) => {
      if (el && el.isConnected) el.remove();
    });
    document.documentElement.classList.remove(
      'dsh-stage-active',
      'dsh-legacy-mode',
      'dsh-learning-mode',
      'dsh-hide-native-cc',
      'dsh-video-paused'
    );
    document.documentElement.style.removeProperty('--dsh-stage-width');
    document.documentElement.style.removeProperty('--dsh-stage-height');
    translateBtnEl = null;
    modeMenuEl = null;
    stageModeBtnEl = null;
    stageModeLabelEl = null;
    stageEl = null;
    bottomEl = null;
    bottomOrigEl = null;
    bottomTransEl = null;
    overlayEl = null;
    listEl = null;
    itemEls = [];
    legacyViewEl = null;
    learningViewEl = null;
    legacySubAreaEl = null;
    learnSubAreaEl = null;
    captionHostEl = null;
    legacySlotEl = null;
    learnSlotEl = null;
    learnVidStage = null;
    legacyCtlEl = null;
    legacyTimelineFillEl = null;
    legacyTimeFloatEl = null;
    legacyThumbEl = null;
    legacyTitleEl = null;
    legacyPlayEl = null;
    legacyAutoEl = null;
    legacyRepeatEl = null;
    legacySpeedBtnEl = null;
    learnCtlEl = null;
    learnSidebarEl = null;
    learnListEl = null;
    learnTabCountEl = null;
    learnAuraEl = null;
    learnNavTitleEl = null;
    learnNavChannelEl = null;
    learnEngineEl = null;
    learnProgFillEl = null;
    learnProgScrubEl = null;
    learnTimeEl = null;
    learnPlayEl = null;
    learnAutoEl = null;
    learnRepeatEl = null;
    learnMuteEl = null;
    learnSpeedBtnEl = null;
    learnIdxEl = null;
    speedPanelEl = null;
    speedSliderEl = null;
    speedValueEl = null;
    diagEl = null;
    diagHideTimer = null;
    wordEls = [];
    wordTimes = [];
    lastSyncedMp = null;
    lastSlotRectKey = '';
    pendingStageSync = false;
  }

  function isVideoPage() {
    return !!getVideoIdFromUrl();
  }

  function safeStart() {
    if (!isVideoPage()) {
      hideVideoChrome();
      return;
    }
    start();
  }

  /* ---------------- 底部双语字幕（经典模式 / 学习模式） ---------------- */
  function getVideoMeta() {
    const title = (document.title || 'YouTube').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube.*$/, '');
    const chEl = document.querySelector('ytd-channel-name #text a, ytd-channel-name #text');
    const channel = (chEl && chEl.textContent || '').trim();
    const thumb = currentVideoId ? ('https://i.ytimg.com/vi/' + currentVideoId + '/mqdefault.jpg') : '';
    return { title: title || 'YouTube', channel, thumb };
  }

  function makeCtlBtn(cls, viewBox, size, path, title, onClick) {
    const b = document.createElement('button');
    b.className = cls;
    b.type = 'button';
    if (title) b.title = title;
    b.dataset.iconKey = size + ':' + path;
    b.appendChild(makeSvg(viewBox, size, [path]));
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function bindProgressScrub(barEl) {
    const seekAt = (clientX) => {
      const v = videoEl();
      if (!v || !v.duration || !isFinite(v.duration)) return;
      const r = barEl.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
      autoPausedKey = null;
      lastPlayIdx = -1;
      v.currentTime = ratio * v.duration;
      if (repeatOn) repeatIdx = Math.max(0, findActive(v.currentTime));
    };
    barEl.addEventListener('click', (e) => { e.stopPropagation(); seekAt(e.clientX); });
  }

  function syncStageViewport() {
    const root = document.documentElement;
    if (!root) return;
    root.style.setProperty('--dsh-stage-width', window.innerWidth + 'px');
    root.style.setProperty('--dsh-stage-height', window.innerHeight + 'px');
  }

  function scheduleStageSync() {
    if (pendingStageSync) return;
    pendingStageSync = true;
    setTimeout(() => {
      pendingStageSync = false;
      syncStageControls();
      syncVideoSlotRect();
    }, 80);
  }

  function syncStageControls() {
    if (!enabled || !stageEl || !translateBtnEl || !translateBtnEl.isConnected) return;
    const stageActive = document.documentElement.classList.contains('dsh-stage-active');
    if (stageActive) {
      if (translateBtnEl.parentElement !== stageEl) {
        translateBtnEl.classList.add('in-stage');
        stageEl.appendChild(translateBtnEl);
        scheduleStageSync();
      }
    } else if (translateBtnEl.parentElement === stageEl) {
      const fullscreen = document.querySelector('.ytp-fullscreen-button');
      const host = fullscreen && fullscreen.parentElement;
      translateBtnEl.classList.remove('in-stage');
      if (host) {
        fullscreen.after(translateBtnEl);
      }
      scheduleStageSync();
    }
  }

  function syncVideoSlotRect() {
    if (!enabled || !stageEl) return;
    syncStageViewport();
    const mp = document.querySelector('#movie_player');
    const slot = (mode === 'legacy') ? legacySlotEl : learnSlotEl;
    if (!mp || !slot) return;
    const playerHost = document.querySelector('ytd-app');
    const stageParent = stageEl.parentElement;
    if (playerHost && stageParent) {
      if (playerHost.parentElement !== stageParent || playerHost.nextElementSibling !== stageEl) {
        originalScrollY = window.scrollY || 0;
        stageParent.insertBefore(playerHost, stageEl);
        window.scrollTo(0, originalScrollY);
      }
    }
    const r = slot.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const stageWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-stage-width')) || viewportWidth;
    const stageHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-stage-height')) || viewportHeight;
    const scaleX = viewportWidth / Math.max(1, stageWidth);
    const scaleY = viewportHeight / Math.max(1, stageHeight);
    const x = Math.round(r.left * scaleX);
    const y = Math.round(r.top * scaleY);
    const w = Math.round(r.width * scaleX);
    const h = Math.round(r.height * scaleY);
    const rectKey = x + ':' + y + ':' + w + ':' + h;
    if (mp === lastSyncedMp && rectKey === lastSlotRectKey && mp.style.width) return;
    lastSyncedMp = mp;
    lastSlotRectKey = rectKey;
    mp.style.left = x + 'px';
    mp.style.top = y + 'px';
    mp.style.width = w + 'px';
    mp.style.height = h + 'px';
  }

  function clearPlayerSlotRect() {
    lastSyncedMp = null;
    lastSlotRectKey = '';
    const mp = document.querySelector('#movie_player');
    if (!mp) return;
    mp.style.left = '';
    mp.style.top = '';
    mp.style.width = '';
    mp.style.height = '';
    mp.style.position = '';
  }

  function restorePageLayout() {
    const root = document.documentElement;
    const playerHost = document.querySelector('ytd-app');
    if (playerHost && playerHost.parentElement === root) {
      root.removeChild(playerHost);
      document.body.insertBefore(playerHost, document.body.firstChild);
    }
    root.style.removeProperty('--dsh-stage-width');
    root.style.removeProperty('--dsh-stage-height');
    clearPlayerSlotRect();
    window.scrollTo(0, originalScrollY);
  }

  function toggleStageFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    setTimeout(syncVideoSlotRect, 120);
  }

  function toggleMute() {
    const v = videoEl();
    if (!v) return;
    v.muted = !v.muted;
    refreshControllers();
  }

  function ensureStage() {
    if (stageEl) return;
    stageEl = document.createElement('div');
    stageEl.id = 'dsh-stage';

    /* ---------- 1. 经典模式视图（双栏字幕模式） ---------- */
    legacyViewEl = document.createElement('div');
    legacyViewEl.style.cssText = 'display:none;width:100%;height:100%;';

    const legMain = document.createElement('div');
    legMain.className = 'dsh-legacy-main';
    const legVidWrap = document.createElement('div');
    legVidWrap.className = 'dsh-legacy-video-wrap';
    legacySlotEl = document.createElement('div');
    legacySlotEl.className = 'dsh-video-slot';
    legVidWrap.appendChild(legacySlotEl);

    legacySubAreaEl = document.createElement('div');
    legacySubAreaEl.className = 'dsh-legacy-subarea';
    const legacyCaptionHost = document.createElement('div');
    legacyCaptionHost.className = 'dsh-caption-host';
    legacyCaptionHost.dataset.mode = 'legacy';
    legacySubAreaEl.appendChild(legacyCaptionHost);
    legMain.append(legVidWrap, legacySubAreaEl);

    legacyCtlEl = document.createElement('div');
    legacyCtlEl.className = 'dsh-legacy-controller';
    const legTimeline = document.createElement('div');
    legTimeline.className = 'dsh-legacy-timeline';
    const legTrack = document.createElement('div');
    legTrack.className = 'dsh-legacy-track';
    legacyTimelineFillEl = document.createElement('div');
    legacyTimelineFillEl.className = 'dsh-legacy-fill';
    legTrack.appendChild(legacyTimelineFillEl);
    legTimeline.appendChild(legTrack);
    bindProgressScrub(legTimeline);
    legacyTimeFloatEl = document.createElement('div');
    legacyTimeFloatEl.className = 'dsh-legacy-time-float';
    legacyTimeFloatEl.textContent = '00:00';
    legacyCtlEl.append(legTimeline, legacyTimeFloatEl);

    const legLeft = document.createElement('div');
    legLeft.className = 'dsh-ctl-left';
    const album = document.createElement('div');
    album.className = 'dsh-ctl-album';
    const cover = document.createElement('div');
    cover.className = 'dsh-ctl-cover';
    legacyThumbEl = document.createElement('img');
    legacyThumbEl.alt = '';
    cover.appendChild(legacyThumbEl);
    legacyTitleEl = document.createElement('div');
    legacyTitleEl.className = 'dsh-ctl-title';
    album.append(cover, legacyTitleEl);
    legLeft.appendChild(album);

    const legMid = document.createElement('div');
    legMid.className = 'dsh-ctl-middle';
    legacyAutoEl = makeCtlBtn('dsh-ctl-btn first md', '0 0 24 24', 20, ICONS.autoPause, '句末暂停 (J)', toggleAutoPause);
    const legPrev = makeCtlBtn('dsh-ctl-btn md', '0 0 24 24', 24, ICONS.prev, '上一句 (◀)', () => seekLearn(-1));
    legacyPlayEl = makeCtlBtn('dsh-ctl-btn lg', '0 0 24 24', 22, ICONS.play, '播放/暂停 (K)', togglePlay);
    const legNext = makeCtlBtn('dsh-ctl-btn md', '0 0 24 24', 24, ICONS.next, '下一句 (▶)', () => seekLearn(1));
    legacyRepeatEl = makeCtlBtn('dsh-ctl-btn md', '0 0 24 24', 20, ICONS.repeat, '单句循环 (R)', toggleRepeat);
    legMid.append(legacyAutoEl, legPrev, legacyPlayEl, legNext, legacyRepeatEl);

    const legRight = document.createElement('div');
    legRight.className = 'dsh-ctl-right';
    const legToLearn = makeCtlBtn('dsh-ctl-btn icon-right', '0 0 24 24', 18, ICONS.learnIcon, '切换到学习模式 (M)', () => applyMode('learning'));
    legacySpeedBtnEl = document.createElement('button');
    legacySpeedBtnEl.className = 'dsh-ctl-btn speed';
    legacySpeedBtnEl.type = 'button';
    legacySpeedBtnEl.textContent = '1x';
    legacySpeedBtnEl.title = '播放速度 (E/W)';
    legacySpeedBtnEl.addEventListener('click', (e) => { e.stopPropagation(); toggleSpeedPanel(); });
    const legFs = makeCtlBtn('dsh-ctl-btn icon-right', '0 0 24 24', 18, ICONS.fullscreen, '全屏', toggleStageFullscreen);
    legRight.append(legToLearn, legacySpeedBtnEl, legFs);
    legacyCtlEl.append(legLeft, legMid, legRight);
    legMain.appendChild(legacyCtlEl);

    const legAside = document.createElement('div');
    legAside.className = 'dsh-legacy-aside';
    const exitBtn = document.createElement('button');
    exitBtn.className = 'dsh-btn-exit';
    exitBtn.type = 'button';
    exitBtn.appendChild(makeSvg('0 0 24 24', 16, [ICONS.close]));
    const exitTip = document.createElement('span');
    exitTip.className = 'dsh-exit-tip';
    exitTip.textContent = '退出 (ESC)';
    exitBtn.appendChild(exitTip);
    exitBtn.addEventListener('click', (e) => { e.stopPropagation(); applyMode('off'); });

    overlayEl = document.createElement('div');
    overlayEl.id = 'dsh-sub-overlay';
    listEl = document.createElement('div');
    listEl.className = 'dsh-list';
    overlayEl.appendChild(listEl);
    legAside.append(exitBtn, overlayEl);
    legacyViewEl.append(legMain, legAside);

    /* ---------- 2. 学习模式视图（沉浸练习风格） ---------- */
    learningViewEl = document.createElement('div');
    learningViewEl.style.cssText = 'display:none;flex-direction:column;width:100%;height:100%;';

    const nav = document.createElement('div');
    nav.className = 'dsh-learn-navbar';
    const navLeft = document.createElement('div');
    navLeft.className = 'dsh-learn-nav-left';
    const backBtn = makeCtlBtn('dsh-learn-back', '0 0 24 24', 20, ICONS.back, '退出学习模式 (ESC)', () => applyMode('off'));
    const navMeta = document.createElement('div');
    navMeta.className = 'dsh-learn-meta';
    learnNavTitleEl = document.createElement('div');
    learnNavTitleEl.className = 'dsh-learn-video-title';
    learnNavChannelEl = document.createElement('div');
    learnNavChannelEl.className = 'dsh-learn-channel';
    navMeta.append(learnNavTitleEl, learnNavChannelEl);
    navLeft.append(backBtn, navMeta);

    const navRight = document.createElement('div');
    navRight.className = 'dsh-learn-nav-right';
    learnEngineEl = document.createElement('div');
    learnEngineEl.className = 'dsh-nav-pill';
    const navFs = makeCtlBtn('dsh-nav-icon-btn', '0 0 24 24', 18, ICONS.fullscreen, '全屏', toggleStageFullscreen);
    const navSide = makeCtlBtn('dsh-nav-icon-btn', '0 0 24 24', 18, ICONS.sidebar, '收起/展开字幕栏', () => {
      if (learnSidebarEl) {
        learnSidebarEl.classList.toggle('collapsed');
        setTimeout(syncVideoSlotRect, 30);
      }
    });
    navRight.append(learnEngineEl, navFs, navSide);
    nav.append(navLeft, navRight);

    const content = document.createElement('div');
    content.className = 'dsh-learn-content';

    const learnMain = document.createElement('div');
    learnMain.className = 'dsh-learn-main';
    learnAuraEl = document.createElement('div');
    learnAuraEl.className = 'dsh-learn-bg-aura';
    const learnVidWrap = document.createElement('div');
    learnVidWrap.className = 'dsh-learn-video-wrap';
    learnVidStage = document.createElement('div');
    learnVidStage.className = 'dsh-learn-video-stage';
    learnSlotEl = document.createElement('div');
    learnSlotEl.className = 'dsh-video-slot';
    learnVidStage.appendChild(learnSlotEl);
    learnVidWrap.appendChild(learnVidStage);
    learnSubAreaEl = document.createElement('div');
    learnSubAreaEl.className = 'dsh-learn-subarea';
    const learnCaptionHost = document.createElement('div');
    learnCaptionHost.className = 'dsh-caption-host';
    learnCaptionHost.dataset.mode = 'learning';
    learnSubAreaEl.appendChild(learnCaptionHost);

    learnCtlEl = document.createElement('div');
    learnCtlEl.id = 'dsh-learn-controller';
    const prog = document.createElement('div');
    prog.className = 'dsh-learn-progress';
    const progTrack = document.createElement('div');
    progTrack.className = 'dsh-learn-progress-track';
    learnProgFillEl = document.createElement('div');
    learnProgFillEl.className = 'dsh-learn-progress-fill';
    learnProgScrubEl = document.createElement('div');
    learnProgScrubEl.className = 'dsh-learn-progress-scrubber';
    progTrack.append(learnProgFillEl, learnProgScrubEl);
    prog.appendChild(progTrack);
    bindProgressScrub(prog);

    const ctlRow = document.createElement('div');
    ctlRow.className = 'dsh-learn-ctl-row';
    const ctlLeft = document.createElement('div');
    ctlLeft.className = 'dsh-learn-ctl-left';
    learnPlayEl = makeCtlBtn('dsh-ctl-btn first md', '0 0 24 24', 22, ICONS.play, '播放/暂停 (K)', togglePlay);
    const lrnPrev = makeCtlBtn('dsh-ctl-btn first md', '0 0 24 24', 22, ICONS.prev, '上一句 (◀)', () => seekLearn(-1));
    const lrnNext = makeCtlBtn('dsh-ctl-btn first md', '0 0 24 24', 22, ICONS.next, '下一句 (▶)', () => seekLearn(1));
    learnAutoEl = makeCtlBtn('dsh-ctl-btn first md', '0 0 24 24', 19, ICONS.autoPause, '句末暂停 (J)', toggleAutoPause);
    learnTimeEl = document.createElement('span');
    learnTimeEl.className = 'dsh-learn-time';
    learnTimeEl.textContent = '00:00 / 00:00';
    learnRepeatEl = document.createElement('button');
    learnRepeatEl.className = 'dsh-ab-pill';
    learnRepeatEl.type = 'button';
    learnRepeatEl.textContent = 'AB';
    learnRepeatEl.title = '单句循环 (R)';
    learnRepeatEl.addEventListener('click', (e) => { e.stopPropagation(); toggleRepeat(); });
    ctlLeft.append(learnPlayEl, lrnPrev, lrnNext, learnAutoEl, learnTimeEl, learnRepeatEl);

    const ctlRight = document.createElement('div');
    ctlRight.className = 'dsh-learn-ctl-right';
    learnIdxEl = document.createElement('span');
    learnIdxEl.className = 'dsh-ctl-idx';
    learnIdxEl.textContent = '0 / 0';
    learnMuteEl = makeCtlBtn('dsh-ctl-btn icon-right', '0 0 24 24', 18, ICONS.volumeOn, '静音', toggleMute);
    learnSpeedBtnEl = document.createElement('button');
    learnSpeedBtnEl.className = 'dsh-ctl-btn speed';
    learnSpeedBtnEl.type = 'button';
    learnSpeedBtnEl.textContent = '1x';
    learnSpeedBtnEl.title = '播放速度 (E/W)';
    learnSpeedBtnEl.addEventListener('click', (e) => { e.stopPropagation(); toggleSpeedPanel(); });
    ctlRight.append(learnIdxEl, learnMuteEl, learnSpeedBtnEl);

    ctlRow.append(ctlLeft, ctlRight);
    learnCtlEl.append(prog, ctlRow);
    learnMain.append(learnAuraEl, learnVidWrap, learnSubAreaEl, learnCtlEl);

    learnSidebarEl = document.createElement('div');
    learnSidebarEl.className = 'dsh-learn-sidebar';
    const tabs = document.createElement('div');
    tabs.className = 'dsh-learn-tabs';
    const tab = document.createElement('div');
    tab.className = 'dsh-learn-tab';
    const tabText = document.createElement('span');
    tabText.textContent = '字幕';
    learnTabCountEl = document.createElement('span');
    learnTabCountEl.className = 'dsh-learn-tab-count';
    learnTabCountEl.textContent = '0';
    tab.append(tabText, learnTabCountEl);
    tabs.appendChild(tab);
    learnListEl = document.createElement('div');
    learnListEl.className = 'dsh-learn-list';
    learnSidebarEl.append(tabs, learnListEl);

    content.append(learnMain, learnSidebarEl);
    learningViewEl.append(nav, content);

    stageEl.append(legacyViewEl, learningViewEl);
    ensureSpeedPanel();
    (document.body || document.documentElement).appendChild(stageEl);

    if (typeof ResizeObserver !== 'undefined') {
      slotResizeObs = new ResizeObserver(() => syncVideoSlotRect());
      slotResizeObs.observe(legacySlotEl);
      slotResizeObs.observe(learnSlotEl);
      slotResizeObs.observe(legVidWrap);
      slotResizeObs.observe(learnVidStage);
    }
    window.addEventListener('resize', syncVideoSlotRect);
    refreshControllers();
  }

  function ensureBottom() {
    ensureStage();
    if (!bottomEl) {
      bottomEl = document.createElement('div');
      bottomEl.id = 'dsh-bottom-captions';
      const box = document.createElement('div');
      box.className = 'dsh-cap-box';
      bottomOrigEl = document.createElement('div');
      bottomOrigEl.className = 'dsh-cap-original';
      bottomTransEl = document.createElement('div');
      bottomTransEl.className = 'dsh-cap-translation';
      box.append(bottomOrigEl, bottomTransEl);
      bottomEl.appendChild(box);
    }
    const targetHost = document.querySelector(`.dsh-caption-host[data-mode="${mode}"]`) || captionHostEl || legacySubAreaEl;
    captionHostEl = targetHost;
    if (targetHost && bottomEl.parentElement !== targetHost) {
      targetHost.appendChild(bottomEl);
    }
    bottomEl.classList.remove('video-overlay');
    applyBottomStyles();
  }

  function ensureSpeedPanel() {
    if (speedPanelEl) return;
    speedPanelEl = document.createElement('div');
    speedPanelEl.className = 'dsh-speed-panel';
    speedPanelEl.style.display = 'none';

    const head = document.createElement('div');
    head.className = 'dsh-speed-header';
    const st = document.createElement('div');
    st.className = 'dsh-speed-title';
    st.textContent = '播放速度';
    speedValueEl = document.createElement('div');
    speedValueEl.className = 'dsh-speed-value';
    head.append(st, speedValueEl);

    const range = document.createElement('div');
    range.className = 'dsh-speed-range';
    const minus = document.createElement('button');
    minus.className = 'dsh-speed-icon-btn';
    minus.textContent = '−';
    minus.addEventListener('click', (e) => { e.stopPropagation(); changeRate(-0.05); });
    speedSliderEl = document.createElement('input');
    speedSliderEl.className = 'dsh-speed-slider';
    speedSliderEl.type = 'range';
    speedSliderEl.min = '0.5';
    speedSliderEl.max = '3';
    speedSliderEl.step = '0.05';
    speedSliderEl.value = '1';
    speedSliderEl.addEventListener('input', () => setLearnRate(parseFloat(speedSliderEl.value)));
    const plus = document.createElement('button');
    plus.className = 'dsh-speed-icon-btn';
    plus.textContent = '+';
    plus.addEventListener('click', (e) => { e.stopPropagation(); changeRate(0.05); });
    range.append(minus, speedSliderEl, plus);

    const presets = document.createElement('div');
    presets.className = 'dsh-speed-presets';
    [['0.5x', 0.5], ['0.75x', 0.75], ['0.9x', 0.9], ['正常', 1], ['1.1x', 1.1], ['1.25x', 1.25], ['1.5x', 1.5], ['2.0x', 2]].forEach(([label, val]) => {
      const b = document.createElement('button');
      b.className = 'dsh-speed-preset';
      b.textContent = label;
      b.dataset.rate = String(val);
      b.addEventListener('click', (e) => { e.stopPropagation(); setLearnRate(val); });
      presets.appendChild(b);
    });

    speedPanelEl.append(head, range, presets);
    stageEl.appendChild(speedPanelEl);
  }

  function applyBottomStyles() {
    if (!bottomEl) return;
    const s = settings || DEFAULTS;
    bottomEl.classList.remove('learning');
    bottomEl.style.setProperty('--dsh-font-size', (s.fontSize || 21) + 'px');
    refreshControllers();
  }

  function setBtnIcon(btn, path, size) {
    if (!btn) return;
    const key = size + ':' + path;
    if (btn.dataset.iconKey === key) return;
    btn.dataset.iconKey = key;
    const old = btn.querySelector('svg');
    const next = makeSvg('0 0 24 24', size, [path]);
    if (old) btn.replaceChild(next, old);
    else btn.appendChild(next);
  }

  function refreshStageMeta() {
    if (!stageEl) return;
    const meta = getVideoMeta();
    if (legacyTitleEl) legacyTitleEl.textContent = meta.title;
    if (legacyThumbEl && meta.thumb && legacyThumbEl.src !== meta.thumb) legacyThumbEl.src = meta.thumb;
    if (learnNavTitleEl) learnNavTitleEl.textContent = meta.title;
    if (learnNavChannelEl) learnNavChannelEl.textContent = meta.channel;
    if (learnAuraEl && meta.thumb) learnAuraEl.style.backgroundImage = 'url("' + meta.thumb + '")';
    if (learnEngineEl) {
      const s = settings || DEFAULTS;
      const pLabel = (PROVIDERS[s.provider] && PROVIDERS[s.provider].label) || s.provider || '翻译';
      learnEngineEl.textContent = pLabel.replace(/（.*）/, '') + ' · ' + (s.targetLang || '简体中文');
    }
    if (learnTabCountEl) learnTabCountEl.textContent = String(sentences.length);
  }

  function refreshControllers() {
    const v = videoEl();
    const playing = !!(v && !v.paused);
    document.documentElement.classList.toggle('dsh-video-paused', !!v && v.paused);
    const cur = v && isFinite(v.currentTime) ? v.currentTime : 0;
    const dur = v && isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    const pct = dur > 0 ? Math.max(0, Math.min(100, (cur / dur) * 100)) : 0;
    const rateLabel = (Math.round(learnRate * 100) / 100) + 'x';

    if (legacyPlayEl) setBtnIcon(legacyPlayEl, playing ? ICONS.pause : ICONS.play, 22);
    if (learnPlayEl) setBtnIcon(learnPlayEl, playing ? ICONS.pause : ICONS.play, 22);
    if (legacyAutoEl) legacyAutoEl.classList.toggle('active', autoPause);
    if (learnAutoEl) learnAutoEl.classList.toggle('active', autoPause);
    if (legacyRepeatEl) legacyRepeatEl.classList.toggle('active', repeatOn);
    if (learnRepeatEl) learnRepeatEl.classList.toggle('active', repeatOn);
    if (learnMuteEl) setBtnIcon(learnMuteEl, (v && v.muted) ? ICONS.volumeOff : ICONS.volumeOn, 18);

    if (legacyTimelineFillEl) legacyTimelineFillEl.style.width = pct.toFixed(2) + '%';
    if (legacyTimeFloatEl) legacyTimeFloatEl.textContent = formatTime(cur);
    if (learnProgFillEl) learnProgFillEl.style.width = pct.toFixed(2) + '%';
    if (learnProgScrubEl) learnProgScrubEl.style.left = pct.toFixed(2) + '%';
    if (learnTimeEl) learnTimeEl.textContent = formatTime(cur) + ' / ' + formatTime(dur);

    if (legacySpeedBtnEl) legacySpeedBtnEl.textContent = rateLabel;
    if (learnSpeedBtnEl) learnSpeedBtnEl.textContent = rateLabel;
    if (speedValueEl) speedValueEl.textContent = rateLabel;
    if (speedSliderEl) speedSliderEl.value = String(Math.round(learnRate * 100) / 100);
    if (speedPanelEl) {
      speedPanelEl.querySelectorAll('.dsh-speed-preset').forEach((b) => {
        b.classList.toggle('active', Math.abs(parseFloat(b.dataset.rate) - learnRate) < 0.001);
      });
    }
  }

  function toggleAutoPause() {
    autoPause = !autoPause;
    if (!autoPause) {
      autoPausedKey = null;
    } else {
      const v = videoEl();
      const idx = currentSentenceIndex();
      if (v && v.paused && idx >= 0 && sentences[idx] && v.currentTime >= sentences[idx].end - 0.2) {
        autoPausedKey = sentences[idx].key;
      }
    }
    refreshControllers();
  }

  function changeFontSize(delta) {
    settings = Object.assign({}, settings || DEFAULTS);
    settings.fontSize = Math.max(13, Math.min(28, (settings.fontSize || 21) + delta));
    saveSettings({ fontSize: settings.fontSize });
    applyBottomStyles();
    if (overlayEl) applyStyles();
  }

  function changeRate(delta) {
    setLearnRate(learnRate + delta);
  }

  function setLearnRate(r) {
    r = Math.max(0.5, Math.min(3, Math.round(r * 100) / 100));
    learnRate = r;
    const v = videoEl();
    if (v) v.playbackRate = r;
    refreshControllers();
  }

  function toggleSpeedPanel() {
    if (!speedPanelEl) return;
    const open = speedPanelEl.style.display !== 'none';
    speedPanelEl.style.display = open ? 'none' : 'block';
  }

  function toggleRepeat() {
    repeatOn = !repeatOn;
    const idx = currentSentenceIndex();
    const v = videoEl();
    if (repeatOn) {
      repeatIdx = idx >= 0 ? idx : 0;
      if (v && sentences[repeatIdx]) {
        autoPausedKey = null;
        v.currentTime = sentences[repeatIdx].start;
        if (v.paused) v.play().catch(() => {});
      }
    } else {
      repeatIdx = -1;
    }
    refreshControllers();
  }

  function buildWords(s) {
    wordEls = [];
    wordTimes = [];
    while (bottomOrigEl.firstChild) bottomOrigEl.removeChild(bottomOrigEl.firstChild);
    const tokens = s.text.split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      bottomOrigEl.textContent = s.text;
      return;
    }
    for (let i = 0; i < tokens.length; i++) {
      const span = document.createElement('span');
      span.className = 'dsh-word';
      const token = document.createElement('span');
      token.className = 'dsh-token';
      token.textContent = tokens[i];
      span.appendChild(token);
      bottomOrigEl.appendChild(span);
      wordEls.push(span);
      const w = s.words && s.words[i];
      wordTimes.push({
        start: Number.isFinite(w && w.start) ? w.start : s.start + (s.end - s.start) * i / tokens.length,
        end: Number.isFinite(w && w.end) ? w.end : s.start + (s.end - s.start) * (i + 1) / tokens.length
      });
      if (i < tokens.length - 1) bottomOrigEl.appendChild(document.createTextNode(' '));
    }
  }

  function updateBottom(idx) {
    if (!bottomEl || !sentences[idx]) return;
    const s = sentences[idx];
    if (bottomOrigEl) {
      if (mode === 'learning') buildWords(s);
      else bottomOrigEl.textContent = s.text;
    }
    if (bottomTransEl) {
      if (transCache.has(s.key)) { bottomTransEl.textContent = transCache.get(s.key); bottomTransEl.classList.remove('pending'); }
      else if (translating.has(s.key)) { bottomTransEl.textContent = '⏳ 翻译中…'; bottomTransEl.classList.add('pending'); }
      else { bottomTransEl.textContent = ''; bottomTransEl.classList.add('pending'); }
    }
    if (learnIdxEl) learnIdxEl.textContent = (idx + 1) + ' / ' + sentences.length;
    lastRenderKey = s.key;
    refreshControllers();
  }

  function currentSentenceIndex() {
    const v = videoEl();
    if (!v || !sentences.length) return -1;
    return findActive(v.currentTime);
  }

  function seekLearn(dir) {
    const idx = currentSentenceIndex();
    const base = idx < 0 ? 0 : idx;
    const target = base + dir;
    if (target < 0 || target >= sentences.length) return;
    const v = videoEl();
    if (v) {
      autoPausedKey = null;
      lastPlayIdx = target;
      lastPlayTime = sentences[target].start;
      if (repeatOn) repeatIdx = target;
      v.currentTime = sentences[target].start;
      if (v.paused) v.play().catch(() => {});
    }
  }

  function replayLearn() {
    const idx = currentSentenceIndex();
    if (idx < 0) return;
    const v = videoEl();
    if (v) {
      autoPausedKey = null;
      lastPlayIdx = idx;
      lastPlayTime = sentences[idx].start;
      v.currentTime = sentences[idx].start;
      if (v.paused) v.play().catch(() => {});
    }
  }

  function togglePlay() {
    const v = videoEl();
    if (!v) return;
    if (v.paused) {
      if (autoPause && sentences.length) {
        const idx = findActive(v.currentTime);
        if (idx >= 0 && sentences[idx] && v.currentTime >= sentences[idx].end - 0.25) {
          autoPausedKey = sentences[idx].key;
        }
      }
      v.play().catch(() => {});
    } else {
      v.pause();
    }
    setTimeout(refreshControllers, 60);
  }

  /* ---------------- 初始化 ---------------- */
  let bridgeReadyResolve = null;
  const bridgeReady = new Promise((r) => { bridgeReadyResolve = r; });
  // 监听 bridge 就绪事件（bridge 注入后主动 postMessage）
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    if (ev.data && ev.data.__dshYTBridgeReady) bridgeReadyResolve();
  });

  (async function boot() {
    settings = await getSettings();
    mode = settings.mode || 'off';
    enabled = mode !== 'off' && settings.enabled !== false;
    restorePageLayout();
    if (!isVideoPage()) {
      hideVideoChrome();
    } else {
      ensureBottom();
      if (enabled) setStageMode(mode);
    }
    hookBridge();
    wireMessages();
    scheduleMount();
    // 点击按钮/菜单以外区域时收起模式菜单
    document.addEventListener('click', (e) => {
      if (modeMenuEl && modeMenuEl.style.display !== 'none' &&
          translateBtnEl && !translateBtnEl.contains(e.target) && !modeMenuEl.contains(e.target)) {
        modeMenuEl.style.display = 'none';
      }
      if (speedPanelEl && speedPanelEl.style.display !== 'none' &&
          !speedPanelEl.contains(e.target) &&
          (!legacySpeedBtnEl || !legacySpeedBtnEl.contains(e.target)) &&
          (!learnSpeedBtnEl || !learnSpeedBtnEl.contains(e.target))) {
        speedPanelEl.style.display = 'none';
      }
    });
    window.addEventListener('scroll', () => {
      if (modeMenuEl && modeMenuEl.style.display !== 'none') {
        modeMenuEl.style.display = 'none';
      }
    }, { passive: true });
    // 键盘快捷键（经典模式 & 学习模式通用）
    window.addEventListener('keydown', (e) => {
      if (!enabled || mode === 'off') return;
      const el = e.target;
      const tag = (el && el.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (el && el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      const consume = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
      if (k === 'Escape' && !document.fullscreenElement) { consume(); applyMode('off'); }
      else if (k === 'm' || k === 'M') { consume(); applyMode(mode === 'legacy' ? 'learning' : 'legacy'); }
      else if (k === 'ArrowLeft') { consume(); seekLearn(-1); }
      else if (k === 'ArrowRight') { consume(); seekLearn(1); }
      else if (k === 'r' || k === 'R') { consume(); toggleRepeat(); }
      else if (k === ' ' || k === 'k' || k === 'K') { consume(); togglePlay(); }
      else if (k === 'e' || k === 'E') { consume(); changeRate(0.05); }
      else if (k === 'w' || k === 'W') { consume(); changeRate(-0.05); }
      else if (k === 'ArrowUp') { consume(); const v = videoEl(); if (v) v.volume = Math.min(1, v.volume + 0.05); }
      else if (k === 'ArrowDown') { consume(); const v = videoEl(); if (v) v.volume = Math.max(0, v.volume - 0.05); }
      else if (k === 'j' || k === 'J') { consume(); toggleAutoPause(); }
      else if (k === '=' || k === '+') { consume(); changeFontSize(1); }
      else if (k === '-' || k === '_') { consume(); changeFontSize(-1); }
    }, true);
    // 等 bridge 就绪（最多 3s）再开始取字幕，避免 nudge 时 bridge 还没装好
    const t = setTimeout(() => bridgeReadyResolve(), 3000);
    await bridgeReady;
    clearTimeout(t);
    checkVideo(true);
  })();

  function wireMessages() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (msg && msg.type === 'TOGGLE') {
          enabled = !!msg.enabled;
          if (enabled) {
            if (mode === 'off') {
              mode = (settings && settings.mode && settings.mode !== 'off') ? settings.mode : 'legacy';
              saveSettings({ enabled: true, mode });
            }
            if (!sentences.length) acquireAndLoad();
            safeStart();
          } else {
            stop();
          }
          sendResponse({ ok: true, enabled });
        } else if (msg && msg.type === 'TOGGLE_REQUEST') {
          enabled = !enabled;
          if (enabled && mode === 'off') mode = 'legacy';
          saveSettings({ enabled, mode: enabled ? mode : 'off' });
          if (enabled) {
            if (!sentences.length) acquireAndLoad();
            safeStart();
          } else {
            stop();
          }
          sendResponse({ ok: true, enabled });
        } else if (msg && msg.type === 'SETTINGS_UPDATED') {
          settings = Object.assign({}, settings || {}, msg.settings || {});
          if (msg.settings && msg.settings.mode != null) mode = msg.settings.mode;
          enabled = mode !== 'off' && settings.enabled !== false;
          failedKeys.clear();
          cooldownUntil = 0;
          if (enabled) {
            if (isVideoPage()) {
              ensureBottom();
              if (!sentences.length) acquireAndLoad();
            }
          }
          applyBottomStyles();
          if (enabled) {
            safeStart();
            if (sentences.length) {
              buildList();
              lastRenderKey = null;
              lastActiveKey = null;
              const curIdx = Math.max(0, currentSentenceIndex());
              updateBottom(curIdx);
              highlightActive(curIdx);
            }
          } else {
            stop();
          }
          refreshTranslateButton();
          sendResponse({ ok: true });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return false;
    });
  }

  /* ---------------- 右侧面板 DOM ---------------- */
  function ensureOverlay() {
    ensureStage();
  }

  function applyStyles() {
    if (!stageEl) return;
    const s = settings || DEFAULTS;
    stageEl.style.setProperty('--dsh-font-size', (s.fontSize || 22) + 'px');
    updatePanelTitle();
  }

  function setStageMode(targetMode) {
    const root = document.documentElement;
    if (!root) return;
    if (!isVideoPage()) {
      hideVideoChrome();
      return;
    }
    clearPlayerSlotRect();
    const active = targetMode === 'legacy' || targetMode === 'learning';
    if (active) {
      ensureStage();
      ensureModeMenu();
      ensureStageModeButton();
    }
    root.classList.toggle('dsh-stage-active', active);
    root.classList.toggle('dsh-legacy-mode', targetMode === 'legacy');
    root.classList.toggle('dsh-learning-mode', targetMode === 'learning');
    syncStageViewport();
    if (!active) {
      restorePageLayout();
      if (translateBtnEl && translateBtnEl.isConnected) {
        const fullscreen = document.querySelector('.ytp-fullscreen-button');
        const host = fullscreen && fullscreen.parentElement;
        if (host) {
          fullscreen.after(translateBtnEl);
        }
        translateBtnEl.classList.remove('in-stage');
      }
      if (stageModeBtnEl && stageModeBtnEl.parentElement === stageEl) {
        stageEl.removeChild(stageModeBtnEl);
      }
      stageEl.className = '';
      stageEl.style.display = 'none';
      legacyViewEl.style.display = 'none';
      learningViewEl.style.display = 'none';
      clearPlayerSlotRect();
      return;
    }
    if (translateBtnEl && translateBtnEl.isConnected) {
      translateBtnEl.classList.add('in-stage');
      if (translateBtnEl.parentElement !== stageEl) {
        stageEl.appendChild(translateBtnEl);
      }
    }
    if (stageModeBtnEl && stageModeBtnEl.parentElement !== stageEl) {
      stageEl.appendChild(stageModeBtnEl);
    }
    stageEl.style.display = 'flex';
    stageEl.className = targetMode;
    legacyViewEl.style.display = (targetMode === 'legacy') ? 'flex' : 'none';
    learningViewEl.style.display = (targetMode === 'learning') ? 'flex' : 'none';
    ensureBottom();
    refreshStageMeta();
    requestAnimationFrame(syncVideoSlotRect);
    scheduleStageSync();
  }

  function updatePanelTitle() {
    if (!headTitleEl) return;
    const s = settings || DEFAULTS;
    let title = '双语字幕 → ' + (s.targetLang || '简体中文');
    if (lastTranslateError) {
      // 提取错误里的关键信息（如 402 余额不足）
      const err = lastTranslateError;
      if (err.indexOf('402') >= 0 || err.indexOf('Insufficient') >= 0 || err.indexOf('Balance') >= 0) {
        title = '⚠️ 翻译引擎余额不足，请充值或更换 API Key';
      } else if (err.indexOf('401') >= 0) {
        title = '⚠️ API Key 无效，请在设置中检查';
      } else {
        title = '⚠️ 翻译失败: ' + err.slice(0, 40);
      }
    }
    headTitleEl.textContent = title;
    headTitleEl.style.color = lastTranslateError ? '#ff6b6b' : '#ffffff';
  }

  /* ---------------- 主循环 ---------------- */
  function start() {
    if (!isVideoPage()) {
      hideVideoChrome();
      return;
    }
    if (mode === 'off') mode = 'legacy';
    setStageMode(mode);
    applyStyles();
    if (sentences.length) buildList();
    if (bottomEl) bottomEl.style.display = 'block';
    applyBottomStyles();
    document.documentElement.classList.add('dsh-hide-native-cc');
    refreshTranslateButton();
    if (!rafId) rafId = requestAnimationFrame(loop);
    scheduleStageSync();
  }

  function stop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    setStageMode('off');
    if (bottomEl) bottomEl.style.display = 'none';
    if (speedPanelEl) speedPanelEl.style.display = 'none';
    document.documentElement.classList.remove('dsh-hide-native-cc');
    document.documentElement.classList.remove('dsh-video-paused');
    refreshTranslateButton();
  }

  function loop() {
    if (!enabled) { rafId = null; return; }
    try {
      scheduleTranslations();
      render();
    } catch (error) {
      console.warn('[subtitle] render cycle error', error);
    }
    rafId = requestAnimationFrame(loop);
    scheduleStageSync();
  }

  function currentTime() {
    const v = videoEl();
    return v ? v.currentTime : -1;
  }

  // 构建右侧列表（所有句子：原文 + 译文）
  function buildList() {
    const container = (mode === 'learning') ? learnListEl : listEl;
    if (!container) return;
    // 用 replaceChildren 清空（避免 innerHTML 被 Trusted Types 拦截）
    while (container.firstChild) container.removeChild(container.firstChild);
    itemEls = [];
    const showOrig = settings.showOriginal;
    const showTrans = settings.showTranslation;
    if (learnTabCountEl) learnTabCountEl.textContent = String(sentences.length);
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const item = document.createElement('div');
      item.className = (mode === 'learning') ? 'dsh-learn-item' : 'dsh-item';
      item.dataset.idx = String(i);

      if (mode === 'learning') {
        const meta = document.createElement('div');
        meta.className = 'dsh-learn-item-meta';
        const timeEl = document.createElement('span');
        timeEl.className = 'dsh-learn-item-time';
        timeEl.textContent = formatTime(s.start);
        const copyBtn = document.createElement('button');
        copyBtn.className = 'dsh-learn-item-copy';
        copyBtn.type = 'button';
        copyBtn.textContent = '复制';
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const txt = s.text + (transCache.has(s.key) ? ('\n' + transCache.get(s.key)) : '');
          navigator.clipboard && navigator.clipboard.writeText(txt).catch(() => {});
          copyBtn.textContent = '已复制';
          setTimeout(() => { copyBtn.textContent = '复制'; }, 1200);
        });
        meta.append(timeEl, copyBtn);
        item.appendChild(meta);
        if (showOrig) {
          const orig = document.createElement('div');
          orig.className = 'dsh-original';
          orig.textContent = s.text;
          item.appendChild(orig);
        }
        if (showTrans) {
          const trans = document.createElement('div');
          trans.className = 'dsh-translation';
          trans.dataset.key = s.key;
          if (transCache.has(s.key)) trans.textContent = transCache.get(s.key);
          else if (translating.has(s.key)) { trans.textContent = '⏳ 翻译中…'; trans.classList.add('pending'); }
          else { trans.textContent = ''; trans.classList.add('pending'); }
          item.appendChild(trans);
        }
      } else {
        // 行容器：时间戳 + 原文同一行（经典模式字幕风格）
        const line = document.createElement('div');
        line.className = 'dsh-line';

        const timeEl = document.createElement('div');
        timeEl.className = 'dsh-time';
        timeEl.textContent = formatTime(s.start);
        line.appendChild(timeEl);

        // 文本列：原文 + 译文（两行左对齐同一列）
        const body = document.createElement('div');
        body.className = 'dsh-body';
        if (showOrig) {
          const orig = document.createElement('div');
          orig.className = 'dsh-original';
          orig.textContent = s.text;
          body.appendChild(orig);
        }
        if (showTrans) {
          const trans = document.createElement('div');
          trans.className = 'dsh-translation';
          trans.dataset.key = s.key;
          if (transCache.has(s.key)) trans.textContent = transCache.get(s.key);
          else if (translating.has(s.key)) { trans.textContent = '⏳ 翻译中…'; trans.classList.add('pending'); }
          else { trans.textContent = ''; trans.classList.add('pending'); }
          body.appendChild(trans);
        }
        line.appendChild(body);
        item.appendChild(line);
      }

      // 点击跳转播放
      item.addEventListener('click', () => {
        const v = videoEl();
        if (v) {
          autoPausedKey = null;
          lastPlayIdx = i;
          lastPlayTime = s.start;
          if (repeatOn) repeatIdx = i;
          v.currentTime = s.start;
          if (v.paused) v.play().catch(() => {});
        }
      });

      container.appendChild(item);
      itemEls.push(item);
    }
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function render() {
    const v = videoEl();
    if (!v) { return; }
    refreshControllers();
    if (!sentences.length || !bottomEl) { return; }
    const t = v.currentTime;

    // 单句循环（AB）：经典模式与学习模式通用，锁定目标句不越界
    if (repeatOn) {
      if (repeatIdx < 0 || repeatIdx >= sentences.length) {
        repeatIdx = Math.max(0, findActive(t));
      }
      const rs = sentences[repeatIdx];
      if (rs && (t >= rs.end - 0.03 || t < rs.start - 0.2)) {
        v.currentTime = rs.start;
        if (v.paused) v.play().catch(() => {});
        lastPlayIdx = repeatIdx;
        lastPlayTime = rs.start;
        return;
      }
    }

    const idx = findActive(t);
    if (idx < 0) {
      lastPlayIdx = -1;
      lastPlayTime = t;
      return;
    }

    const s = sentences[idx];

    // 句末自动暂停（仅当用户主动开启时生效，每句只暂停一次，点播放后立即顺畅继续）
    if (!v.paused && !repeatOn && autoPause) {
      const delta = lastPlayTime >= 0 ? (t - lastPlayTime) : 0;
      if (lastPlayIdx >= 0 && idx > lastPlayIdx && delta > 0 && delta < 0.45) {
        const prevS = sentences[lastPlayIdx];
        if (prevS && autoPausedKey !== prevS.key) {
          autoPausedKey = prevS.key;
          v.pause();
          const holdT = Math.max(prevS.start, prevS.end - 0.02);
          if (Math.abs(t - holdT) < 0.45) {
            try { v.currentTime = holdT; } catch (e) {}
          }
          refreshControllers();
          return;
        }
      }
      if (t >= s.end - 0.035 && t <= s.end + 0.65 && autoPausedKey !== s.key) {
        autoPausedKey = s.key;
        v.pause();
        refreshControllers();
      }
    }

    if (!v.paused) {
      if (autoPausedKey === s.key && t < s.end - 0.35) {
        autoPausedKey = null;
      }
      lastPlayIdx = idx;
      lastPlayTime = t;
    }

    if (t > s.end + 0.7) { return; }

    // 右侧面板高亮当前句 + 滚动跟随（经典模式 & 学习模式均同步）
    if (s.key !== lastActiveKey) {
      highlightActive(idx);
    }
    const near = Math.min(idx + 4, sentences.length);
    for (let i = Math.max(0, idx - 1); i < near; i++) updateItemTranslation(i);

    // 当前句变化时刷新底部字幕
    if (s.key !== lastRenderKey) {
      updateBottom(idx);
    } else if (bottomTransEl && transCache.has(s.key) && bottomTransEl.textContent !== transCache.get(s.key)) {
      bottomTransEl.textContent = transCache.get(s.key);
      bottomTransEl.classList.remove('pending');
    }

    // 学习模式：逐词高亮 + 控制条状态同步
    if (mode === 'learning') {
      updateWordHighlight(s, t);
    }
  }

  function updateWordHighlight(s, t) {
    if (!wordEls.length) return;
    let active = wordTimes.findIndex((w) => t < w.end);
    if (active < 0) active = wordTimes.length - 1;
    for (let i = 0; i < wordEls.length; i++) {
      const el = wordEls[i];
      const w = wordTimes[i];
      const isCurrent = i === active && t >= w.start && t < w.end;
      el.classList.toggle('played', i < active || t >= w.end);
      el.classList.toggle('active', isCurrent || (i === active && t >= w.start));
      el.classList.toggle('active-current', isCurrent);
      if (isCurrent) {
        const duration = Math.max(0.04, w.end - w.start);
        const progress = Math.max(0, Math.min(1, (t - w.start) / duration));
        el.style.setProperty('--word-time', duration.toFixed(3) + 's');
        el.style.setProperty('--word-progress', progress.toFixed(4));
        el.style.animationDelay = (-duration * progress).toFixed(3) + 's';
      } else {
        el.style.removeProperty('--word-time');
        el.style.removeProperty('--word-progress');
        el.style.removeProperty('animation-delay');
      }
    }
  }

  function clearHighlight() {
    lastActiveKey = null;
    if (!itemEls) return;
    for (const el of itemEls) el.classList.remove('active');
  }

  function highlightActive(idx) {
    if (!itemEls || !itemEls[idx]) return;
    lastActiveKey = sentences[idx].key;
    for (let i = 0; i < itemEls.length; i++) {
      itemEls[i].classList.remove('active');
      if (i < idx) itemEls[i].classList.add('played');
      else itemEls[i].classList.remove('played');
    }
    itemEls[idx].classList.add('active');
    // 滚动跟随：让当前句保持在面板可见区域内（偏上 1/3 处）
    const scrollBox = (mode === 'learning') ? learnListEl : listEl;
    if (scrollBox) {
      const target = itemEls[idx];
      const targetTop = target.offsetTop - scrollBox.offsetTop - scrollBox.clientHeight / 3;
      scrollBox.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    }
  }

  function updateItemTranslation(idx) {
    if (!itemEls || !itemEls[idx]) return;
    const item = itemEls[idx];
    const trans = item.querySelector('.dsh-translation');
    if (!trans) return;
    const key = sentences[idx].key;
    if (transCache.has(key)) {
      trans.textContent = transCache.get(key);
      trans.classList.remove('pending');
    } else if (translating.has(key)) {
      if (trans.textContent !== '⏳ 翻译中…') { trans.textContent = '⏳ 翻译中…'; trans.classList.add('pending'); }
    }
  }

  function findActive(t) {
    let lo = 0, hi = sentences.length - 1, ans = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (sentences[m].start <= t) { ans = m; lo = m + 1; }
      else hi = m - 1;
    }
    return ans;
  }

  function scheduleTranslations() {
    if (!sentences.length) return;
    const t = currentTime();
    if (t < 0) return;
    const idx = findActive(t);
    if (idx < 0) return;
    if (Date.now() < cooldownUntil) return;
    const end = Math.min(idx + 3, sentences.length);
    for (let i = idx; i < end; i++) {
      const s = sentences[i];
      if (transCache.has(s.key) || translating.has(s.key) || failedKeys.has(s.key)) continue;
      translateSentence(s);
    }
  }

  async function translateSentence(s) {
    translating.add(s.key);
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'TRANSLATE', text: s.text });
      if (resp && resp.ok && resp.translated) {
        transCache.set(s.key, resp.translated);
        persistCache(s.key, resp.translated);
        // 若正是底部字幕当前显示句，实时填充译文
        if (bottomTransEl && lastRenderKey === s.key) {
          bottomTransEl.textContent = resp.translated;
          bottomTransEl.classList.remove('pending');
        }
        lastTranslateError = '';
      } else {
        failedKeys.add(s.key);
        cooldownUntil = Date.now() + 8000;
        lastTranslateError = (resp && resp.error) || '翻译失败';
        updatePanelTitle();
      }
    } catch (e) {
      failedKeys.add(s.key);
      cooldownUntil = Date.now() + 8000;
      lastTranslateError = String(e && e.message || e);
      updatePanelTitle();
    } finally {
      translating.delete(s.key);
    }
  }

  /* ---------------- 缓存持久化 ---------------- */
  async function loadCacheFor(videoId) {
    try {
      const data = await chrome.storage.local.get('transcache');
      const cache = data.transcache || {};
      transCache.clear();
      for (const k in cache) {
        if (k.indexOf(videoId + ':') === 0) transCache.set(k, cache[k]);
      }
    } catch (e) { /* ignore */ }
  }

  function persistCache(key, text) {
    chrome.storage.local.get('transcache', (data) => {
      const c = data.transcache || {};
      c[key] = text;
      const keys = Object.keys(c);
      if (keys.length > 600) {
        keys.sort();
        for (let i = 0; i < keys.length - 600; i++) delete c[keys[i]];
      }
      chrome.storage.local.set({ transcache: c });
    });
  }

  /* ---------------- 视频检测 / SPA 导航 ---------------- */
  function getVideoIdFromUrl() {
    const u = new URL(location.href);
    if (u.hostname.endsWith('youtube.com')) {
      if (u.pathname.startsWith('/watch')) return u.searchParams.get('v');
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
    }
    return null;
  }

  let navTimer = null;
  window.addEventListener('yt-navigate-finish', () => {
    clearTimeout(navTimer);
    navTimer = setTimeout(() => checkVideo(true), 700);
  });
  window.addEventListener('yt-page-data-updated', () => {
    clearTimeout(navTimer);
    navTimer = setTimeout(() => checkVideo(false), 900);
  });

  async function checkVideo(force) {
    const id = getVideoIdFromUrl();
    if (!id) {
      currentVideoId = null;
      hideVideoChrome();
      return;
    }
    scheduleMount();
    if (id === currentVideoId && !force) return;
    currentVideoId = id;
    cues = [];
    sentences = [];
    lastActiveKey = null;
    lastRenderKey = null;
    autoPausedKey = null;
    repeatIdx = -1;
    lastPlayIdx = -1;
    lastPlayTime = -1;
    refreshStageMeta();
    lastHtml = null;
    failedKeys.clear();
    cooldownUntil = 0;
    await loadCacheFor(id);
    if (enabled) acquireAndLoad();
  }

  /* ================================================================
   * 字幕获取管线（通过播放器自身请求获取字幕）
   * 优先级：拦截缓存（播放器自己拉的）→ refetch HTML → timedtext →
   *         transcript API → nudge+拦截 → 转录稿面板
   * ================================================================ */

  async function acquireAndLoad() {
    if (acquiring) return;
    acquiring = true;
    try {
      diag('视频 ' + currentVideoId + '：开始获取字幕…', true);

      // --- Stage 0: 等播放器就绪（document_start 时播放器未渲染）---
      await waitForPlayer(10000);
      if (currentVideoId !== getVideoIdFromUrl()) return; // 已导航到别的视频

      // --- Stage A: nudge 让播放器自己拉字幕（CC 按钮 / toggleSubtitles）---
      // 播放器自己的请求会带有效签名+POT，被 bridge 的 XHR hook 拦截缓存。
      let nudged = await bridgeNudge();
      // nudge 失败重试（最多 3 次，间隔 1s）
      for (let i = 0; i < 3 && !nudged.ok; i++) {
        await sleep(1000);
        nudged = await bridgeNudge();
      }
      diag(nudged.ok ? '已触发播放器请求字幕 (nudge=' + nudged.via + ')' : '播放器 nudge 失败', true);

      // 等拦截缓存（最多 8s）
      let intercepted = [];
      if (nudged.ok) {
        intercepted = await waitIntercepted(8000);
        diag('拦截到字幕请求 ' + intercepted.length + ' 条', true);
      }

      // --- Stage B: 拦截缓存中找目标轨道 ---
      let got = [];
      if (intercepted.length) {
        got = pickFromIntercepted(intercepted);
      }

      // --- Stage C: refetch HTML + timedtext（旧路径，部分视频可用）---
      if (!got.length) {
        diag('拦截无结果，尝试直接拉取…', true);
        let tracks = await tracksFromBridge(1200);
        if (!tracks.length) tracks = await tracksFromRefetch();
        if (tracks.length) {
          const track = pickTrack(tracks);
          diag('选中轨道 ' + (track.vssId || track.languageCode || '?') + (track.kind === 'asr' ? ' (自动)' : ''), true);
          got = await fetchTimedText(track.baseUrl, false);
          if (!got.length) got = await fetchTimedText(track.baseUrl, true);
        }
      }

      // --- Stage D: get_transcript API ---
      if (!got.length) {
        diag('timedtext 为空，尝试 transcript API…', true);
        got = await fetchViaTranscriptApi();
      }

      // --- Stage E: 转录稿面板兜底 ---
      if (!got.length) {
        diag('尝试打开转录稿面板…', true);
        got = await fetchViaPanel();
      }

      if (!got.length) {
        diag('未能获取字幕（视频可能无字幕或被 YouTube 限制）', true);
        return;
      }

      // --- 归一化 ---
      got.sort((a, b) => a.start - b.start);
      for (let i = 0; i < got.length; i++) {
        if (!(got[i].end > got[i].start)) {
          got[i].end = i + 1 < got.length ? got[i + 1].start : got[i].start + 3;
        }
      }
      cues = got;
      computeSentences();
      ensureBottom();
      if (sentences.length) updateBottom(0);
      if (sentences.length) buildList();
      refreshStageMeta();
      updatePanelTitle();
      if (diagEl) diagEl.style.display = 'none';
      if (enabled) start();
    } finally {
      acquiring = false;
    }
  }

  /* ---------- bridge 通信封装 ---------- */

  function hookBridge() {
    if (bridgeInjected) return;
    bridgeInjected = true;
    // page-bridge.js 由 manifest 的 MAIN world content script 在 document_start 注入。
    // 不再向页面插入 inline script，避免触发 YouTube 的 CSP 限制。
  }

  function bridgeRequest(payload, replyKey, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const onMsg = (ev) => {
        if (ev.source !== window) return;
        const d = ev.data;
        if (d && d[replyKey] && d[replyKey].videoId === currentVideoId) {
          if (done) return;
          done = true;
          window.removeEventListener('message', onMsg);
          clearTimeout(timer);
          resolve(d[replyKey]);
        }
      };
      window.addEventListener('message', onMsg);
      window.postMessage(Object.assign({ __dshYTRequest: payload.__dshYTRequest, videoId: currentVideoId }, payload), '*');
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        resolve(null);
      }, timeoutMs);
    });
  }

  async function bridgeNudge() {
    const r = await bridgeRequest({ __dshYTRequest: 'nudge' }, '__dshYTNudge', 3000);
    if (r && r.result && r.result.ok) return r.result;
    return { ok: false };
  }

  // 等待 YouTube 播放器就绪（#movie_player 出现且可 getPlayerResponse）
  function waitForPlayer(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const el = document.querySelector('#movie_player');
        const v = document.querySelector('video');
        if (el || v) {
          // 播放器元素或 video 已出现
          resolve(true);
          return;
        }
        if (Date.now() - start > timeoutMs) { resolve(false); return; }
        setTimeout(check, 300);
      };
      check();
    });
  }

  // 等待拦截缓存出现（bridge 会推 __dshYTSubtitleLoaded 事件）
  function waitIntercepted(timeoutMs) {
    return new Promise(async (resolve) => {
      // 先看当前缓存
      let dump = await bridgeRequest({ __dshYTRequest: 'dumpIntercepted' }, '__dshYTDump', 2000);
      if (dump && dump.items && dump.items.length) { resolve(dump.items); return; }
      // 等推送
      let done = false;
      const items = [];
      const onMsg = (ev) => {
        if (ev.source !== window) return;
        const d = ev.data;
        if (d && d.__dshYTSubtitleLoaded) {
          // 收到推送后再 dump 一次
          bridgeRequest({ __dshYTRequest: 'dumpIntercepted' }, '__dshYTDump', 2000).then((dump2) => {
            if (!done) { done = true; window.removeEventListener('message', onMsg); clearTimeout(timer); resolve((dump2 && dump2.items) || []); }
          });
        }
      };
      window.addEventListener('message', onMsg);
      const timer = setTimeout(async () => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        const dump2 = await bridgeRequest({ __dshYTRequest: 'dumpIntercepted' }, '__dshYTDump', 2000);
        resolve((dump2 && dump2.items) || []);
      }, timeoutMs);
    });
  }

  // 从拦截缓存里选轨道（优先人工字幕）
  function pickFromIntercepted(items) {
    if (!items || !items.length) return [];
    // 过滤：本视频、非翻译轨（tlang 空）
    const local = items.filter((it) => it.v === currentVideoId && !it.tlang);
    if (!local.length) return [];
    const manual = local.filter((it) => it.kind !== 'asr');
    const chosen = manual[0] || local[0];
    try {
      const j = JSON.parse(chosen.raw);
      return cuesFromJson3(j);
    } catch (e) {
      return [];
    }
  }

  // 旧的 bridge 轨道请求（保留用于 refetch 兜底）
  function tracksFromBridge(timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (tracks) => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve((tracks || []).filter((t) => t && t.baseUrl));
      };
      const onMsg = (ev) => {
        if (ev.source !== window) return;
        const d = ev.data;
        if (d && d.__dshYTCaptions && d.__dshYTCaptions.videoId === currentVideoId) {
          finish(d.__dshYTCaptions.tracks);
        }
      };
      window.addEventListener('message', onMsg);
      window.postMessage({ __dshYTRequest: 'captions', videoId: currentVideoId }, '*');
      const timer = setTimeout(() => finish([]), timeoutMs);
    });
  }

  // 重新 fetch watch 页 HTML 提取轨道（fresh 签名），并缓存 HTML。
  async function tracksFromRefetch() {
    try {
      const resp = await fetch(location.href, { credentials: 'include' });
      if (!resp.ok) return [];
      const html = await resp.text();
      lastHtml = html;
      const pr = extractPlayerResponse(html);
      if (!pr || !pr.captions) return [];
      const list = (pr.captions.playerCaptionsTracklistRenderer || {}).captionTracks || [];
      return list.filter((t) => t && t.baseUrl).map((t) => ({
        baseUrl: t.baseUrl,
        name: (t.name && t.name.simpleText) || '',
        vssId: t.vssId || '',
        languageCode: t.languageCode || '',
        kind: t.kind || ''
      }));
    } catch (e) {
      return [];
    }
  }

  function pickTrack(tracks) {
    if (!tracks || !tracks.length) return null;
    const manual = tracks.filter((t) => t.vssId && t.vssId.indexOf('.') === 0 && t.vssId.indexOf('-t') < 0);
    const asr = tracks.filter((t) => t.kind === 'asr');
    return manual[0] || asr[0] || tracks[0];
  }

  /* ---------- Path 1/2: timedtext ---------- */

  async function fetchTimedText(baseUrl, asJson3) {
    try {
      let url = baseUrl;
      if (asJson3) {
        const u = new URL(baseUrl);
        u.searchParams.set('fmt', 'json3');
        url = u.toString();
      }
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) return [];
      const text = await resp.text();
      if (!text.trim()) return [];
      if (asJson3) {
        const j = JSON.parse(text);
        return cuesFromJson3(j);
      }
      // XML（legacy）
      if (text.indexOf('<text') < 0) return [];
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      const nodes = doc.querySelectorAll('text');
      const out = [];
      for (const n of nodes) {
        const start = parseFloat(n.getAttribute('start') || '0');
        const dur = parseFloat(n.getAttribute('dur') || '0');
        const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) out.push({ start, end: start + dur, text: t });
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  /* ---------- Path 3: get_transcript API ---------- */

  async function fetchViaTranscriptApi() {
    try {
      let html = lastHtml;
      if (!html) {
        const resp = await fetch(location.href, { credentials: 'include' });
        if (!resp.ok) return [];
        html = await resp.text();
        lastHtml = html;
      }
      const { apiKey, visitorData, clientVersion, idToken, params } = extractInnertube(html);
      if (!apiKey || !params) return [];

      const context = { client: { clientName: 'WEB', clientVersion, hl: 'zh-CN', gl: 'US' } };
      const headers = {
        'Content-Type': 'application/json',
        'X-Youtube-Client-Name': '1',
        'X-Youtube-Client-Version': clientVersion
      };
      if (visitorData) {
        context.client.visitorData = visitorData;
        headers['X-Goog-Visitor-Id'] = visitorData;
      }
      if (idToken) headers['X-Youtube-Identity-Token'] = idToken;

      const cues = [];
      let payload = { context, params };
      for (let page = 0; page < 20; page++) {
        const resp = await fetch(
          'https://www.youtube.com/youtubei/v1/get_transcript?key=' + encodeURIComponent(apiKey) + '&prettyPrint=false',
          { method: 'POST', credentials: 'include', headers, body: JSON.stringify(payload) }
        );
        if (!resp.ok) return cues;
        const data = await resp.json();
        const segments = [];
        collectNodes(data, 'transcriptSegmentRenderer', segments);
        for (const s of segments) {
          const runs = (s.snippet && s.snippet.runs) || [];
          const text = runs.map((r) => r.text || '').join('').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          const startMs = parseFloat(s.startMs || '0');
          const endMs = parseFloat(s.endMs || '0');
          cues.push({ start: startMs / 1000, end: endMs / 1000, text });
        }
        const token = findContinuation(data);
        if (!token) break;
        payload = { context, continuation: token };
      }
      return cues;
    } catch (e) {
      return [];
    }
  }

  function extractInnertube(html) {
    const apiKey = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1] || '';
    const visitorData = (html.match(/"visitorData":"([^"]+)"/) || [])[1] || '';
    const idToken = (html.match(/"ID_TOKEN":"([^"]+)"/) || [])[1] || '';
    let clientVersion = '2.20240101.00.00';
    const ctxIdx = html.indexOf('"INNERTUBE_CONTEXT"');
    if (ctxIdx >= 0) {
      const m = html.slice(ctxIdx, ctxIdx + 6000).match(/"clientVersion":"([^"]+)"/);
      if (m) clientVersion = m[1];
    }
    let params = '';
    const tpIdx = html.indexOf('getTranscriptEndpoint');
    if (tpIdx >= 0) {
      const m = html.slice(tpIdx, tpIdx + 2000).match(/"params":"([^"]+)"/);
      if (m) {
        try { params = decodeURIComponent(m[1]); } catch (e) { params = m[1]; }
      }
    }
    return { apiKey, visitorData, clientVersion, idToken, params };
  }

  function collectNodes(obj, key, out) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const v of obj) collectNodes(v, key, out);
      return;
    }
    for (const k of Object.keys(obj)) {
      if (k === key) out.push(obj[k]);
      else collectNodes(obj[k], key, out);
    }
  }

  function findContinuation(data) {
    const lists = [];
    collectNodes(data, 'transcriptSegmentListRenderer', lists);
    for (const list of lists) {
      const conts = list.continuations || [];
      for (const c of conts) {
        const token =
          (c.nextContinuationData && c.nextContinuationData.continuation) ||
          (c.continuationCommand && c.continuationCommand.token);
        if (token) return token;
      }
    }
    const cmds = [];
    collectNodes(data, 'continuationCommand', cmds);
    return (cmds[0] && cmds[0].token) || '';
  }

  /* ---------- Path 4: 驱动「显示转录稿」面板 ---------- */

  async function fetchViaPanel() {
    try {
      // 已开的面板直接抓
      let found = extractPanelCues();
      if (!found.length) {
        let btn = findShowTranscriptButton();
        if (!btn) {
          const more = findExpandDescriptionButton();
          if (more) {
            try { more.scrollIntoView({ block: 'center' }); } catch (e) {}
            more.click();
            await sleep(1500);
          }
          btn = findShowTranscriptButton();
        }
        if (!btn) return [];
        try { btn.scrollIntoView({ block: 'center' }); } catch (e) {}
        btn.click();
        const deadline = Date.now() + 20000;
        while (!found.length && Date.now() < deadline) {
          await sleep(400);
          found = extractPanelCues();
        }
      }
      if (found.length) found = await loadAllPanelCues(found);
      closeTranscriptPanel();
      return found;
    } catch (e) {
      return [];
    }
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function deepElements(root) {
    const out = [];
    const walk = (node) => {
      if (!node || node.nodeType !== 1) return;
      out.push(node);
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
      if (node.shadowRoot) {
        const skids = node.shadowRoot.children;
        for (let i = 0; i < skids.length; i++) walk(skids[i]);
      }
    };
    walk(root);
    return out;
  }

  const TS_RE = /^\d{1,3}:\d{2}(?::\d{2})?$/;

  function parseTsText(t) {
    const parts = (t || '').trim().split(':').map((p) => parseInt(p, 10));
    if (!parts.length || parts.some((n) => Number.isNaN(n))) return null;
    let s = 0;
    for (const p of parts) s = s * 60 + p;
    return s;
  }

  // 从所有 engagement panel 中抓字幕段（经典 + 新版渲染器）。
  function extractPanelCues() {
    const cues = [];
    const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
    const seen = new Set();
    const collect = (panel) => {
      for (const el of deepElements(panel)) {
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'YTD-TRANSCRIPT-SEGMENT-RENDERER') {
          if (seen.has(el)) continue;
          seen.add(el);
          const tsEl = el.querySelector('.segment-timestamp');
          const start = parseTsText(tsEl ? tsEl.textContent : '');
          if (start == null) continue;
          const clone = el.cloneNode(true);
          const cTs = clone.querySelector('.segment-timestamp');
          if (cTs) cTs.remove();
          const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
          if (text) cues.push({ start, end: start, text });
        } else if (tag === 'TRANSCRIPT-SEGMENT-VIEW-MODEL') {
          if (seen.has(el)) continue;
          seen.add(el);
          const tsEl = el.querySelector('.ytwTranscriptSegmentViewModelTimestamp');
          const start = parseTsText(tsEl ? tsEl.textContent : '');
          if (start == null) continue;
          const capEl = el.querySelector('span[role="text"]') || el.querySelector('.ytAttributedStringHost');
          const text = capEl ? (capEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
          if (text && !TS_RE.test(text)) cues.push({ start, end: start, text });
        }
      }
    };
    for (const p of panels) collect(p);
    // 去重 + 排序
    cues.sort((a, b) => a.start - b.start);
    const out = [];
    for (const c of cues) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.start - c.start) < 0.001) {
        if (c.text.length > last.text.length) out[out.length - 1] = c;
      } else out.push(c);
    }
    return out;
  }

  async function loadAllPanelCues(cues) {
    // 虚拟列表：滚动到底部加载更多
    const scrollers = deepElements(document.body).filter((el) => {
      try {
        return el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 100;
      } catch (e) { return false; }
    });
    let stable = 0;
    for (let i = 0; i < 8 && stable < 2 && scrollers.length; i++) {
      const sc = scrollers.sort((a, b) => a.clientHeight - b.clientHeight)[0];
      sc.scrollTop = sc.scrollHeight;
      await sleep(600);
      const now = extractPanelCues();
      if (now.length > cues.length) { cues = now; stable = 0; } else stable++;
    }
    return cues;
  }

  const TRANSCRIPT_LABELS =
    /^(show transcript|transcript|显示转录稿|显示转写文稿|查看转录稿|查看转写文稿|转写文稿|转录文稿|内容转文字|查看文字记录|显示文字记录|文字记录|文字起こしを表示|文字起こし|대본 보기|자막 보기)$/i;

  function findShowTranscriptButton() {
    const els = Array.from(document.querySelectorAll('button, a, tp-yt-paper-button, ytd-button-renderer'));
    const isMatch = (b) => {
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (TRANSCRIPT_LABELS.test(t)) return true;
      const al = b.getAttribute && b.getAttribute('aria-label');
      return !!al && /transcript|转写|转录|文字记录/i.test(al);
    };
    const visible = els.filter((b) => isMatch(b) && b.offsetParent !== null);
    const el = visible[0] || els.find(isMatch) || null;
    if (el && /-/.test(el.tagName || '') && !/^button$/i.test(el.tagName)) {
      const inner = el.querySelector('button, a');
      if (inner) return inner;
    }
    return el;
  }

  function findExpandDescriptionButton() {
    const expander = document.querySelector('ytd-text-inline-expander');
    const byId = expander && expander.querySelector('#expand');
    if (byId) return byId;
    return (
      Array.from(document.querySelectorAll('tp-yt-paper-button, button')).find((b) =>
        /^\s*(\.\.\.|…)?\s*(more|更多|展开)\s*$/i.test(b.textContent || '')
      ) || null
    );
  }

  function closeTranscriptPanel() {
    try {
      const closeBtn = document.querySelector(
        '[aria-label="Close transcript"], [aria-label="关闭转录稿"], [aria-label="关闭转写文稿"], ' +
        'ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] [aria-label="Close"], ' +
        'ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] [aria-label*="关闭"]'
      );
      if (closeBtn) closeBtn.click();
      const less = Array.from(document.querySelectorAll('tp-yt-paper-button, button')).find(
        (b) => /^\s*(show less|收起|显示较少内容)\s*$/i.test(b.textContent || '') && b.offsetParent !== null
      );
      if (less) less.click();
    } catch (e) { /* best effort */ }
  }

  /* ---------- ytInitialPlayerResponse 解析 ---------- */

  function extractPlayerResponse(html) {
    const marker = 'ytInitialPlayerResponse';
    let idx = html.indexOf(marker + ' = ');
    if (idx < 0) idx = html.indexOf(marker + '=');
    if (idx < 0) return null;
    const brace = html.indexOf('{', idx);
    if (brace < 0) return null;
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let k = brace; k < html.length; k++) {
      const ch = html[k];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    if (end < 0) return null;
    try { return JSON.parse(html.slice(brace, end + 1)); } catch (e) { return null; }
  }

  /* ---------------- 句子合并 ---------------- */
  function hashText(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function cuesFromJson3(data) {
    return ((data && data.events) || [])
      .map((e) => {
        const cueStart = (e.tStartMs || 0) / 1000;
        const cueEnd = ((e.tStartMs || 0) + (e.dDurationMs || 0)) / 1000;
        const words = [];
        for (const sg of (e.segs || [])) {
          const text = String(sg.utf8 || '').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          const start = cueStart + (sg.tOffsetMs || 0) / 1000;
          const end = start + (sg.dDurationMs || 0) / 1000;
          const prev = words[words.length - 1];
          if (prev && prev.text === text && Math.abs(prev.start - start) < 0.001) continue;
          words.push({ text, start, end: end > start ? end : cueEnd });
        }
        return {
          start: cueStart,
          end: cueEnd,
          text: words.map((w) => w.text).join(' '),
          words
        };
      })
      .filter((c) => c.text && c.text.trim());
  }

  function estimateWords(cue) {
    const tokens = String(cue.text || '').split(/\s+/).filter(Boolean);
    const duration = Math.max(0.04, cue.end - cue.start);
    const weights = tokens.map((t) => Math.max(1, t.length));
    const total = weights.reduce((sum, n) => sum + n, 0) || tokens.length || 1;
    let cursor = cue.start;
    return tokens.map((text, i) => {
      const span = duration * weights[i] / total;
      const word = { text, start: cursor, end: cursor + span };
      cursor = word.end;
      return word;
    });
  }

  function computeSentences() {
    const out = [];
    let cur = null;
    const END_PUNCT = /[.!?。！？…]$/;
    for (const c of cues) {
      const text = (c.text || '').trim();
      if (!text) continue;
      if (!cur) {
        cur = { start: c.start, end: c.end, text, words: Array.isArray(c.words) && c.words.length ? c.words.slice() : estimateWords(c) };
      } else {
        const gap = c.start - cur.end;
        const combinedLen = (cur.text + ' ' + text).length;
        if (gap <= 0.65 && !END_PUNCT.test(cur.text) && combinedLen <= 125) {
          cur.text = (cur.text + ' ' + text).replace(/\s+/g, ' ').trim();
          cur.end = c.end;
          const nextWords = Array.isArray(c.words) && c.words.length ? c.words : estimateWords(c);
          cur.words = cur.words.concat(nextWords);
        } else {
          out.push(cur);
          cur = { start: c.start, end: c.end, text, words: Array.isArray(c.words) && c.words.length ? c.words.slice() : estimateWords(c) };
        }
      }
    }
    if (cur && cur.text) out.push(cur);
    sentences = out.map((s, i) => {
      const wordCount = s.text.split(/\s+/).filter(Boolean).length;
      const words = s.words.slice(0, wordCount);
      while (words.length < wordCount) {
        const last = words[words.length - 1];
        words.push({ text: '', start: last ? last.end : s.start, end: last ? last.end + 0.05 : s.end });
      }
      return {
        start: s.start,
        end: s.end,
        text: s.text,
        words,
        key: currentVideoId + ':' + i + ':' + hashText(s.text)
      };
    });
  }
})();
