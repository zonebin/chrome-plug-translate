(function () {
  'use strict';

  if (window.__dshYTBridge) return;
  window.__dshYTBridge = true;

  const timedtextRaw = Object.create(null);
  const timedtextInflight = new Map();
  const contextUrlsByVideo = Object.create(null);

  function currentVideoId() {
    try {
      const url = new URL(location.href);
      if (url.pathname.startsWith('/watch')) return url.searchParams.get('v');
      if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) {
        return url.pathname.split('/')[2] || null;
      }
    } catch (_err) {}
    return null;
  }

  function getPlayerResponse() {
    try {
      const player = document.querySelector('#movie_player');
      if (player && typeof player.getPlayerResponse === 'function') {
        const resp = player.getPlayerResponse();
        if (resp && resp.captions) return resp;
      }
    } catch (_err) {}

    try {
      const flexy = document.querySelector('ytd-watch-flexy');
      if (flexy && flexy.playerData && flexy.playerData.captions) return flexy.playerData;
      if (flexy && flexy.playerResponse && flexy.playerResponse.captions) return flexy.playerResponse;
    } catch (_err) {}

    try {
      if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.captions) {
        return window.ytInitialPlayerResponse;
      }
    } catch (_err) {}

    return null;
  }

  function extractTracks() {
    const playerResp = getPlayerResponse();
    const output = { tracks: [], title: '' };
    if (!playerResp) return output;
    try {
      output.title = (playerResp.videoDetails && playerResp.videoDetails.title) || '';
      const tracklist =
        (playerResp.captions && playerResp.captions.playerCaptionsTracklistRenderer) || {};
      const captionTracks = tracklist.captionTracks || [];
      output.tracks = captionTracks
        .filter((track) => track && track.baseUrl)
        .map((track) => ({
          baseUrl: track.baseUrl,
          name:
            (track.name &&
              (track.name.simpleText ||
                (track.name.runs && track.name.runs.map((run) => run.text).join('')))) ||
            '',
          vssId: track.vssId || '',
          languageCode: track.languageCode || '',
          kind: track.kind || '',
          isTranslatable: !!track.isTranslatable
        }));
    } catch (_err) {}
    return output;
  }

  function recordTimedTextUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl, location.origin);
      const videoId = parsed.searchParams.get('v') || currentVideoId();
      if (!videoId) return;
      if (!contextUrlsByVideo[videoId]) contextUrlsByVideo[videoId] = [];
      const fullUrl = parsed.toString();
      if (!contextUrlsByVideo[videoId].includes(fullUrl)) {
        contextUrlsByVideo[videoId].push(fullUrl);
      }
      timedtextInflight.set(fullUrl, Date.now());
    } catch (_err) {}
  }

  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      const urlStr = typeof url === 'string' ? url : url && url.toString ? url.toString() : '';
      if (urlStr && urlStr.includes('/api/timedtext')) {
        const fullUrl = new URL(urlStr, location.origin).toString();
        recordTimedTextUrl(fullUrl);
        this.addEventListener('load', function () {
          try {
            if (this.status === 200 && this.responseText && this.responseText.trim()) {
              timedtextRaw[fullUrl] = this.responseText;
              window.postMessage(
                {
                  __dshYTSubtitleLoaded: {
                    url: fullUrl,
                    videoId: new URL(fullUrl).searchParams.get('v') || currentVideoId()
                  }
                },
                '*'
              );
            }
          } catch (_err) {}
        });
      }
    } catch (_err) {}
    return nativeXhrOpen.apply(this, arguments);
  };

  if (typeof window.fetch === 'function') {
    const nativeFetch = window.fetch;
    window.fetch = async function (input, init) {
      let urlStr = '';
      try {
        urlStr = typeof input === 'string' ? input : input && input.url ? input.url : '';
      } catch (_err) {}
      const response = await nativeFetch.apply(this, arguments);
      if (urlStr && urlStr.includes('/api/timedtext')) {
        try {
          const fullUrl = new URL(urlStr, location.origin).toString();
          recordTimedTextUrl(fullUrl);
          response
            .clone()
            .text()
            .then((body) => {
              if (body && body.trim()) {
                timedtextRaw[fullUrl] = body;
                window.postMessage(
                  {
                    __dshYTSubtitleLoaded: {
                      url: fullUrl,
                      videoId: new URL(fullUrl).searchParams.get('v') || currentVideoId()
                    }
                  },
                  '*'
                );
              }
            })
            .catch(() => {});
        } catch (_err) {}
      }
      return response;
    };
  }

  function dumpIntercepted() {
    const items = [];
    for (const url in timedtextRaw) {
      try {
        const parsed = new URL(url);
        items.push({
          url,
          v: parsed.searchParams.get('v'),
          lang: parsed.searchParams.get('lang') || '',
          kind: parsed.searchParams.get('kind') || '',
          tlang: parsed.searchParams.get('tlang') || '',
          raw: timedtextRaw[url]
        });
      } catch (_err) {}
    }
    return items;
  }

  function nudgePlayer() {
    try {
      const ccBtn = document.querySelector('.ytp-subtitles-button');
      if (ccBtn) {
        const pressed = ccBtn.getAttribute('aria-pressed') === 'true';
        if (!pressed) {
          ccBtn.click();
          return { ok: true, via: 'cc-button' };
        }
        ccBtn.click();
        setTimeout(() => {
          try {
            ccBtn.click();
          } catch (_err) {}
        }, 380);
        return { ok: true, via: 'cc-button-retrigger' };
      }
    } catch (_err) {}

    try {
      const player = document.querySelector('#movie_player');
      if (player && typeof player.toggleSubtitles === 'function') {
        player.toggleSubtitles();
        return { ok: true, via: 'toggleSubtitles' };
      }
    } catch (_err) {}

    return { ok: false };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const payload = event.data;
    if (!payload || !payload.__dshYTRequest) return;

    const requestType = payload.__dshYTRequest;
    if (requestType === 'captions') {
      const extracted = extractTracks();
      window.postMessage(
        {
          __dshYTCaptions: {
            videoId: currentVideoId(),
            tracks: extracted.tracks,
            title: extracted.title
          }
        },
        '*'
      );
    } else if (requestType === 'dumpIntercepted') {
      window.postMessage(
        {
          __dshYTDump: {
            videoId: payload.videoId,
            items: dumpIntercepted()
          }
        },
        '*'
      );
    } else if (requestType === 'nudge') {
      window.postMessage(
        {
          __dshYTNudge: {
            videoId: payload.videoId,
            result: nudgePlayer()
          }
        },
        '*'
      );
    }
  });

  window.postMessage({ __dshYTBridgeReady: true }, '*');
})();
