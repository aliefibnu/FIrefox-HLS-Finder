/**
 * HLS Finder — Popup Script (v2, GUI mode)
 *
 * - Fetches current tab's detected streams from the background on open.
 * - Listens for real-time stream updates while popup is open.
 * - Renders each stream as an interactive row with copy button.
 * - Deduplicates by URL.
 */

(function () {
  "use strict";

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const streamList = document.getElementById("streamList");
  const emptyState = document.getElementById("emptyState");
  const footer = document.getElementById("footer");
  const countVal = document.getElementById("countVal");
  const countPlural = document.getElementById("countPlural");
  const btnClear = document.getElementById("btnClear");
  const toast = document.getElementById("toast");
  const headerSub = document.getElementById("headerSub");
  const statusDot = document.getElementById("statusDot");
  const statusLabel = document.getElementById("statusLabel");

  // ── State ─────────────────────────────────────────────────────────────────
  let streams = [];
  let toastTimer = null;
  let currentTabId = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function formatTime(isoString) {
    try {
      return new Date(isoString).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function sourceLabel(stream) {
    if (stream.detectedBy === "content-type-header") return "Header";
    if (stream.detectedBy === "in-page-intercept") return stream.type || "XHR";
    return "URL";
  }

  function sourceIcon(stream) {
    // Globe = network, Code = XHR/fetch, Tag = content-type
    if (stream.detectedBy === "content-type-header") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
        <line x1="7" y1="7" x2="7.01" y2="7"/>
      </svg>`;
    }
    if (stream.detectedBy === "in-page-intercept") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>`;
    }
    // URL pattern
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>`;
  }

  // Truncate hostname for subtitle
  function getHostname(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }

  // ── SVG Icons ─────────────────────────────────────────────────────────────

  const ICON_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>`;

  const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`;

  // ── Render ────────────────────────────────────────────────────────────────

  function createStreamItem(stream, index) {
    const item = document.createElement("div");
    item.className = "stream-item";
    item.style.animationDelay = `${Math.min(index * 30, 150)}ms`;
    item.setAttribute("role", "listitem");

    item.innerHTML = `
      <span class="badge badge-hls">HLS</span>
      <div class="item-body">
        <div class="item-url" title="${escapeHtml(stream.url)}">${escapeHtml(stream.url)}</div>
        <div class="item-meta">
          <span class="item-time">${formatTime(stream.timestamp)}</span>
          <span class="item-type">
            ${sourceIcon(stream)}
            ${sourceLabel(stream)}
          </span>
          ${stream.contentType ? `<span class="item-type" style="font-size:10px;color:var(--c-text-3)">${escapeHtml(stream.contentType.split(";")[0])}</span>` : ""}
        </div>
      </div>
      <button class="btn-copy" title="Copy URL" aria-label="Copy URL to clipboard">
        ${ICON_COPY}
      </button>
    `;

    const copyBtn = item.querySelector(".btn-copy");
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyToClipboard(stream.url, copyBtn);
    });

    return item;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function render() {
    // Remove existing stream items
    streamList.querySelectorAll(".stream-item").forEach((el) => el.remove());

    const hasStreams = streams.length > 0;

    emptyState.style.display = hasStreams ? "none" : "";
    footer.style.display = hasStreams ? "flex" : "none";

    if (!hasStreams) return;

    countVal.textContent = streams.length;
    countPlural.textContent = streams.length === 1 ? "" : "s";

    streams.forEach((stream, i) => {
      streamList.appendChild(createStreamItem(stream, i));
    });

    // Update subtitle with hostname
    const hostname = getHostname(streams[0]?.url);
    if (hostname) {
      headerSub.textContent = `Monitoring · ${hostname}`;
    }
  }

  // ── Copy to clipboard ─────────────────────────────────────────────────────

  function copyToClipboard(url, btn) {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        // Button feedback
        btn.innerHTML = ICON_CHECK;
        btn.classList.add("copied");
        btn.disabled = true;

        setTimeout(() => {
          btn.innerHTML = ICON_COPY;
          btn.classList.remove("copied");
          btn.disabled = false;
        }, 1800);

        showToast("URL copied to clipboard");
      })
      .catch(() => {
        // Fallback
        try {
          const ta = document.createElement("textarea");
          ta.value = url;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand("copy");
          ta.remove();
          showToast("URL copied!");
        } catch {
          showToast("Failed to copy");
        }
      });
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
  }

  // ── Communication with background ─────────────────────────────────────────

  async function fetchStreams() {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      currentTabId = tabs[0]?.id ?? null;
      if (!currentTabId) return;

      const response = await browser.runtime.sendMessage({
        type: "GET_STREAMS",
        tabId: currentTabId,
      });

      if (response && Array.isArray(response.streams)) {
        streams = response.streams;
        render();
      }
    } catch (err) {
      // Background may not be ready yet
      statusLabel.textContent = "Connecting…";
    }
  }

  // Live updates while popup is open
  browser.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === "STREAM_UPDATE") {
      streams = message.streams;
      render();
    }
  });

  // ── Clear ──────────────────────────────────────────────────────────────────

  btnClear.addEventListener("click", async () => {
    try {
      if (currentTabId) {
        await browser.runtime.sendMessage({
          type: "CLEAR_STREAMS",
          tabId: currentTabId,
        });
      }
      streams = [];
      render();
      headerSub.textContent = "Monitoring network requests";
    } catch {}
  });

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  fetchStreams();
})();
