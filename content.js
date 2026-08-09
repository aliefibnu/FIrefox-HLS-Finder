/**
 * HLS Finder — Content Script (v2, GUI mode)
 *
 * Runs in the context of every web page.
 * Detects HLS streams via:
 *   1. Messages from background.js (webRequest interception)
 *   2. In-page XHR / fetch() patching (catches player SDK requests)
 *
 * All output goes to the popup GUI — no console logging.
 */

(function () {
  'use strict';

  const HLS_PATTERN = /\.m3u8(\?.*)?$/i;

  const seenUrls = new Set();

  /**
   * Forward an in-page detected HLS URL to the background script.
   */
  function reportInPage(url, method) {
    if (!url || seenUrls.has(url)) return;
    if (!HLS_PATTERN.test(url)) return;

    seenUrls.add(url);

    browser.runtime.sendMessage({
      type: 'IN_PAGE_HLS',
      stream: {
        url: String(url),
        tabId: null,
        frameId: null,
        type: method,
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

  // ── Listen for HLS_FOUND from background (for any future use) ───────────
  // (No-op in GUI mode; background already tracks everything centrally)

})();
