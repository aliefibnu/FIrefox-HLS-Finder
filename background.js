/**
 * Media Finder — Background Script
 *
 * Intercepts all network requests and detects video media by:
 * 1. URL pattern matching (video file extensions)
 * 2. Response Content-Type header checking (video/* MIME types)
 *
 * Detected media are forwarded to the popup GUI via messaging.
 * Also updates the extension badge with the count of detected media.
 */

// Store found media URLs per tab to avoid duplicate reporting
const foundStreams = {};

// Video file extensions to detect in URL path/query
const VIDEO_URL_PATTERN = /\.(m3u8|mpd|ts|mp4|webm|mkv|mov|avi|flv|wmv|m4v|ogv|3gp|3g2)(\?.*)?$/i;

// Known video/stream MIME types
const VIDEO_CONTENT_TYPES = [
  // HLS
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
  'audio/x-mpegurl',
  'audio/mpegurl',
  // DASH
  'application/dash+xml',
  // Generic video MIME types
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-flv',
  'video/x-matroska',
  'video/3gpp',
  'video/3gpp2',
  'video/mpeg',
  'video/mp2t',
  'video/x-ms-wmv',
  'video/x-m4v',
];

/**
 * Determine media type label from URL or MIME type.
 */
function getMediaType(url, contentType) {
  if (contentType) {
    const ct = contentType.toLowerCase().split(';')[0].trim();
    if (ct.includes('mpegurl') || ct.includes('x-mpegurl')) return 'HLS';
    if (ct === 'application/dash+xml') return 'DASH';
    if (ct === 'video/mp2t') return 'MPEG-TS';
    if (ct.startsWith('video/')) {
      const sub = ct.split('/')[1].split('+')[0].toUpperCase();
      return sub;
    }
  }
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
 * Check if a URL looks like a video media file based on its path.
 */
function isVideoUrl(url) {
  try {
    const parsed = new URL(url);
    return VIDEO_URL_PATTERN.test(parsed.pathname) || VIDEO_URL_PATTERN.test(parsed.search);
  } catch {
    return VIDEO_URL_PATTERN.test(url);
  }
}

/**
 * Check if a Content-Type header value matches known video types.
 */
function isVideoContentType(contentType) {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase().split(';')[0].trim();
  // Match any video/* MIME type or explicit list
  return normalized.startsWith('video/') || VIDEO_CONTENT_TYPES.includes(normalized);
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
    if (isVideoUrl(details.url)) {
      const mediaType = getMediaType(details.url, null);
      const streamInfo = {
        url: details.url,
        tabId: details.tabId,
        frameId: details.frameId,
        type: details.type,
        mediaType,
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

    if (contentTypeHeader && isVideoContentType(contentTypeHeader.value)) {
      const mediaType = getMediaType(details.url, contentTypeHeader.value);
      const streamInfo = {
        url: details.url,
        tabId: details.tabId,
        frameId: details.frameId,
        type: details.type,
        contentType: contentTypeHeader.value,
        mediaType,
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

  // Content script: in-page XHR/fetch detected video URL
  if (message.type === 'IN_PAGE_MEDIA' && sender.tab) {
    const tabId = sender.tab.id;
    const streamInfo = { ...message.stream, tabId };
    trackStream(tabId, streamInfo);
    sendResponse({ ok: true });
    return true;
  }
});
