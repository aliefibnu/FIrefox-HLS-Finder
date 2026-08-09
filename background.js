/**
 * HLS Finder — Background Script
 *
 * Intercepts all network requests and detects HLS streams by:
 * 1. URL pattern matching (.m3u8, application/x-mpegurl, etc.)
 * 2. Response Content-Type header checking
 *
 * Detected streams are forwarded to the tab's content script via messaging,
 * so they can be logged directly in that page's console.
 * Also updates the extension badge with the count of detected streams.
 */

// Store found HLS URLs per tab to avoid duplicate reporting
const foundStreams = {};

// HLS URL pattern: matches .m3u8 in path or query string
const HLS_URL_PATTERN = /\.m3u8(\?.*)?$/i;

// HLS content types
const HLS_CONTENT_TYPES = [
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
  'audio/x-mpegurl',
  'audio/mpegurl',
];

/**
 * Check if a URL looks like an HLS stream based on its path.
 */
function isHlsUrl(url) {
  try {
    const parsed = new URL(url);
    return HLS_URL_PATTERN.test(parsed.pathname) || HLS_URL_PATTERN.test(parsed.search);
  } catch {
    return HLS_URL_PATTERN.test(url);
  }
}

/**
 * Check if a Content-Type header value matches known HLS types.
 */
function isHlsContentType(contentType) {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase().split(';')[0].trim();
  return HLS_CONTENT_TYPES.includes(normalized);
}

/**
 * Update the extension badge for a tab with the count of detected streams.
 */
function updateBadge(tabId) {
  const count = foundStreamDetails[tabId] ? foundStreamDetails[tabId].length : 0;
  const text = count > 0 ? String(count) : '';
  browser.browserAction.setBadgeText({ text, tabId });
  browser.browserAction.setBadgeBackgroundColor({ color: '#e53e3e', tabId });
}

/**
 * Track a newly found stream for a tab, avoiding duplicate reports.
 * Also stores the full stream info object for popup retrieval.
 */
const foundStreamDetails = {}; // tabId → StreamInfo[]

function trackStream(tabId, streamInfo) {
  if (!foundStreams[tabId]) {
    foundStreams[tabId] = new Set();
    foundStreamDetails[tabId] = [];
  }

  const key = streamInfo.url;
  if (foundStreams[tabId].has(key)) return; // already reported

  foundStreams[tabId].add(key);
  foundStreamDetails[tabId].push(streamInfo);

  updateBadge(tabId);
  notifyPopup(tabId);
}

/**
 * Push updated stream list to the popup (if it's open).
 */
function notifyPopup(tabId) {
  browser.runtime.sendMessage({
    type: 'STREAM_UPDATE',
    streams: foundStreamDetails[tabId] || [],
  }).catch(() => {
    // Popup is closed — no-op
  });
}

// ─── Listener: Intercept requests by URL pattern ───────────────────────────

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (isHlsUrl(details.url)) {
      const streamInfo = {
        url: details.url,
        tabId: details.tabId,
        frameId: details.frameId,
        type: details.type,
        detectedBy: 'url-pattern',
        timestamp: new Date().toISOString(),
      };
      trackStream(details.tabId, streamInfo);
    }
  },
  { urls: ['<all_urls>'] }
);

// ─── Listener: Intercept responses by Content-Type header ──────────────────

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    const headers = details.responseHeaders || [];
    const contentTypeHeader = headers.find(
      (h) => h.name.toLowerCase() === 'content-type'
    );

    if (contentTypeHeader && isHlsContentType(contentTypeHeader.value)) {
      const streamInfo = {
        url: details.url,
        tabId: details.tabId,
        frameId: details.frameId,
        type: details.type,
        contentType: contentTypeHeader.value,
        detectedBy: 'content-type-header',
        timestamp: new Date().toISOString(),
      };
      trackStream(details.tabId, streamInfo);
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// ─── Cleanup: Remove tracked streams when tab navigates or closes ──────────

browser.tabs.onRemoved.addListener((tabId) => {
  delete foundStreams[tabId];
  delete foundStreamDetails[tabId];
  browser.browserAction.setBadgeText({ text: '', tabId });
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // When the tab starts loading a new page, clear previous streams
  if (changeInfo.status === 'loading' && changeInfo.url) {
    delete foundStreams[tabId];
    delete foundStreamDetails[tabId];
    browser.browserAction.setBadgeText({ text: '', tabId });
  }
});

// ─── Message handler: Respond to popup & content script requests ───────────

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  // Popup: fetch streams for a tab
  if (message.type === 'GET_STREAMS') {
    const tabId = message.tabId;
    sendResponse({ streams: foundStreamDetails[tabId] || [] });
    return true;
  }

  // Popup: clear streams for a tab
  if (message.type === 'CLEAR_STREAMS') {
    const tabId = message.tabId;
    delete foundStreams[tabId];
    delete foundStreamDetails[tabId];
    browser.browserAction.setBadgeText({ text: '', tabId });
    sendResponse({ ok: true });
    return true;
  }

  // Content script: in-page XHR/fetch detected HLS URL
  if (message.type === 'IN_PAGE_HLS' && sender.tab) {
    const tabId = sender.tab.id;
    const streamInfo = { ...message.stream, tabId };
    trackStream(tabId, streamInfo);
    sendResponse({ ok: true });
    return true;
  }
});
