/**
 * Media Finder — Content Script
 *
 * Runs in the context of every web page.
 * Detects video media via:
 *   1. Messages from background.js (webRequest interception)
 *   2. In-page XHR / fetch() patching (catches player SDK requests)
 *   3. <video> / <source> element observation (catches direct src attributes)
 *
 * All output goes to the popup GUI — no console logging.
 */

(function () {
  'use strict';

  // Video file extensions + stream manifests
  const VIDEO_PATTERN = /\.(m3u8|mpd|ts|mp4|webm|mkv|mov|avi|flv|wmv|m4v|ogv|3gp|3g2)(\?.*)?$/i;

  const seenUrls = new Set();

  /**
   * Determine a short media type label from a URL.
   */
  function getMediaType(url) {
    try {
      const ext = new URL(url).pathname.split('.').pop().toLowerCase();
      const extMap = {
        m3u8: 'HLS', mpd: 'DASH', ts: 'MPEG-TS',
        mp4: 'MP4', webm: 'WebM', mkv: 'MKV', mov: 'MOV',
        avi: 'AVI', flv: 'FLV', wmv: 'WMV', m4v: 'M4V',
        ogv: 'OGV', '3gp': '3GP',
      };
      return extMap[ext] || 'VIDEO';
    } catch {
      return 'VIDEO';
    }
  }

  /**
   * Forward an in-page detected video URL to the background script.
   */
  function reportInPage(url, source) {
    if (!url || seenUrls.has(url)) return;

    // Resolve relative URLs
    try {
      url = new URL(url, location.href).href;
    } catch {
      return;
    }

    if (!VIDEO_PATTERN.test(new URL(url).pathname)) return;

    seenUrls.add(url);

    browser.runtime.sendMessage({
      type: 'IN_PAGE_MEDIA',
      stream: {
        url: String(url),
        tabId: null,
        frameId: null,
        type: source,
        mediaType: getMediaType(url),
        detectedBy: 'in-page-intercept',
        timestamp: new Date().toISOString(),
      },
    }).catch(() => {
      // Background may be restarting — ignore
    });
  }

  // ── Patch XMLHttpRequest.open ────────────────────────────────────────────

  const OrigXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try { reportInPage(String(url), 'XHR'); } catch {}
    return OrigXHROpen.apply(this, [method, url, ...rest]);
  };

  // ── Patch fetch() ────────────────────────────────────────────────────────

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input?.url ?? '';
      reportInPage(String(url), 'fetch');
    } catch {}
    return origFetch.apply(this, arguments);
  };

  // ── Observe <video> and <source> elements ────────────────────────────────

  function checkVideoElement(el) {
    const src = el.src || el.getAttribute('src') || el.currentSrc;
    if (src) reportInPage(src, 'video-element');

    // Also check <source> children
    el.querySelectorAll('source').forEach((s) => {
      const ssrc = s.src || s.getAttribute('src');
      if (ssrc) reportInPage(ssrc, 'source-element');
    });
  }

  // Scan existing video elements
  document.querySelectorAll('video').forEach(checkVideoElement);

  // Watch for dynamically added/modified video elements
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Attribute changes on video elements
      if (
        mutation.type === 'attributes' &&
        (mutation.attributeName === 'src' || mutation.attributeName === 'currentSrc') &&
        (mutation.target.tagName === 'VIDEO' || mutation.target.tagName === 'SOURCE')
      ) {
        reportInPage(mutation.target.src || mutation.target.getAttribute('src'), mutation.target.tagName.toLowerCase() + '-element');
      }

      // New nodes added to DOM
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return; // elements only
          if (node.tagName === 'VIDEO') {
            checkVideoElement(node);
          } else if (node.tagName === 'SOURCE' && node.parentElement?.tagName === 'VIDEO') {
            const ssrc = node.src || node.getAttribute('src');
            if (ssrc) reportInPage(ssrc, 'source-element');
          }
          // Also scan descendants
          node.querySelectorAll?.('video').forEach(checkVideoElement);
        });
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'currentSrc'],
  });

})();
