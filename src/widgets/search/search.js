import { Icons, renderIcons } from "/src/core/icon.js";
import { t } from "/src/core/i18n.js";
import { getSettings, subscribe } from "/src/core/storageHandler.js";
import {
  SEARCH_ENGINES,
  buildOrderedProviders,
  getPrefixSuggestions,
  parseDirectUrl,
  resolvePrefixCommand,
} from "./providers.js";
import {
  fetchAutocompleteSuggestions,
  getFaviconUrl,
} from "./autocomplete.js";

const OVERFLOW_X = 0;
const OVERFLOW_Y = 32;
const REST_PAD_X = 44;
const FOCUS_PAD_X = 56;
const INNER_PAD_RIGHT = 20;
const REEL_ITEM_H = 36;
const FONT =
  '500 15px "Quicksand", "Mulish", sans-serif, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"';
const FONT_PREFIX =
  '600 15px "Quicksand", "Mulish", sans-serif, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"';

const FADE_IN_DURATION = 220;
const FALL_OUT_DURATION = 240;
const FALL_OFFSET = 28;
const IME_GUARD_MS = 35;
const CARET_WIDTH = 1.5;
const CARET_RADIUS = 0.75;
const CARET_GAP = 2.2;
const PREFIX_TAIL_GAP = 6;
const PLACEHOLDER_INTERVAL = 5000;
const PLACEHOLDER_MORPH_MS = 520;

const PLACEHOLDER_KEYS = [
  "sp.search.placeholder_0",
  "sp.search.placeholder_1",
  "sp.search.placeholder_2",
  "sp.search.placeholder_3",
  "sp.search.placeholder_4",
  "sp.search.placeholder_5",
  "sp.search.placeholder_6",
  "sp.search.placeholder_7",
];

function getPlaceholders() {
  return PLACEHOLDER_KEYS.map((key) => t(key));
}

const segmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("vi", { granularity: "grapheme" })
    : null;

let cleanupSearchFn = null;

/**
 * Mount and start the canvas-backed Search widget loop and event bindings.
 */
export function startSearchWidget() {
  stopSearchWidget();

  const box = document.getElementById("search-box");
  const canvas = document.getElementById("search-canvas");
  const proxy = document.getElementById("search-proxy");
  const providerSlot = document.getElementById("search-provider-slot");
  const providerIconEl = document.getElementById("search-icon-provider");
  const arrowUpEl = document.getElementById("search-arrow-up");
  const arrowDownEl = document.getElementById("search-arrow-down");
  const reelEl = document.getElementById("search-provider-reel");
  const trackEl = document.getElementById("search-provider-track");
  const autocompleteEl = document.getElementById("search-autocomplete");
  if (!box || !canvas || !proxy) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  renderIcons(box);

  let isFocused = false;
  let isComposing = false;
  let scrollTargetX = 0;
  let scrollVisualX = 0;
  let caretVisualX = 0;
  let caretRawTargetX = 0;
  let selVisualStartX = 0;
  let selVisualEndX = 0;
  let selVisualAlpha = 0;
  let isDragging = false;
  let dragAnchorIdx = 0;
  let lastBlinkReset = performance.now();
  let rafId = null;
  let prevText = "";
  let prevGraphemes = [];
  let charAnims = [];
  let charOffsetX = [];
  let pendingDeletes = [];
  let fallingChars = [];
  let placeholderAlpha = 1;
  let placeholderIdx = 0;
  let lastPlaceholderSwitch = performance.now();
  let placeholderMorph = null;
  let currentPadX = REST_PAD_X;

  // Provider reel state (carousel-like continuous scroll + snap)
  let lastDefaultProviderId =
    getSettings().widgets?.search?.config?.provider || SEARCH_ENGINES[0].id;
  let { providers: orderedProviders, defaultIndex: activeProviderIdx } =
    buildOrderedProviders(lastDefaultProviderId);
  let targetScrollPos = activeProviderIdx;
  let isPickerOpen = false;
  let isTempPrefixProvider = false;
  let activePrefixLength = 0;
  let directUrl = null;
  let arrowAutoCloseTimer = null;
  let wheelSnapTimer = null;
  let reelItems = [];
  let autocompleteItems = [];
  let selectedSuggestionIdx = -1;
  let selectionSource = null;
  let autocompleteReqSeq = 0;
  let autocompleteDebounceTimer = null;
  let autocompleteHeightTimer = null;
  let autocompleteFlipRaf = null;
  const autocompleteRows = new Map();
  let autocompleteHighlightEl = null;

  function syncProviderIcon() {
    const active = orderedProviders[activeProviderIdx] || orderedProviders[0];
    if (providerIconEl) {
      providerIconEl.innerHTML = directUrl
        ? Icons.directUrl || Icons.search || ""
        : Icons[active.icon] || Icons.search || "";
    }
    reelItems.forEach((el, idx) => {
      el.classList.toggle("is-active", idx === activeProviderIdx);
    });
  }

  function updateReelVisual(pos) {
    if (!trackEl) return;
    if (reelItems.length === 0) {
      const offsetY = -(pos * REEL_ITEM_H + REEL_ITEM_H / 2);
      trackEl.style.transform = `translateY(${offsetY.toFixed(2)}px)`;
      return;
    }
    const clamped = Math.max(0, Math.min(reelItems.length - 1, pos));
    const lo = Math.floor(clamped);
    const hi = Math.min(reelItems.length - 1, lo + 1);
    const frac = clamped - lo;
    const loCenter = reelItems[lo].offsetTop + reelItems[lo].offsetHeight / 2;
    const hiCenter = reelItems[hi].offsetTop + reelItems[hi].offsetHeight / 2;
    const centerY = loCenter + (hiCenter - loCenter) * frac;
    trackEl.style.transform = `translateY(${(-centerY).toFixed(2)}px)`;

    reelItems.forEach((el, idx) => {
      const dist = Math.abs(idx - clamped);
      const opacity = Math.max(0.45, 1 - dist * 0.11);
      el.style.opacity = opacity.toFixed(2);
    });
  }

  function renderReelDivider(labelKey) {
    return `<div class="search-provider-divider"><span class="search-provider-divider-label" data-i18n="${labelKey}">${t(labelKey)}</span></div>`;
  }

  function buildProviderReel() {
    if (!trackEl) return;
    trackEl.innerHTML =
      renderReelDivider("sp.search.reel_engines") +
      orderedProviders
        .map(
          (p, idx) => `
      <div class="search-provider-item${idx === activeProviderIdx ? " is-active" : ""}" data-provider-idx="${idx}">
        ${Icons[p.icon] || ""}
        <span class="search-provider-label">${p.label}</span>
      </div>${p.isDefaultSlot ? renderReelDivider("sp.search.reel_social") : ""}
    `,
        )
        .join("");

    reelItems = Array.from(trackEl.querySelectorAll(".search-provider-item"));

    syncProviderIcon();
    updateReelVisual(targetScrollPos);
  }

  function applyReelPosition() {
    updateReelVisual(targetScrollPos);
    const nearestIdx = Math.max(
      0,
      Math.min(orderedProviders.length - 1, Math.round(targetScrollPos)),
    );
    if (nearestIdx !== activeProviderIdx) {
      activeProviderIdx = nearestIdx;
      syncProviderIcon();
    }
  }

  function openTargetUrl(targetUrl) {
    if (!targetUrl) return;
    if (getSettings().widgets?.search?.config?.open_in_new_tab) {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = targetUrl;
    }
  }

  function closeAutocomplete() {
    clearTimeout(autocompleteDebounceTimer);
    clearTimeout(autocompleteHeightTimer);
    if (autocompleteFlipRaf) {
      cancelAnimationFrame(autocompleteFlipRaf);
      autocompleteFlipRaf = null;
    }
    autocompleteReqSeq += 1;
    autocompleteItems = [];
    selectedSuggestionIdx = -1;
    selectionSource = null;
    for (const entry of autocompleteRows.values()) {
      clearTimeout(entry.exitTimer);
    }
    autocompleteRows.clear();
    if (autocompleteEl) {
      autocompleteEl.classList.remove("is-open");
      autocompleteEl.style.height = "";
      autocompleteEl.style.transition = "";
      autocompleteEl.innerHTML = "";
    }
    autocompleteHighlightEl = null;
  }

  function getAutocompleteKey(item) {
    return item.type === "prefix" ? item.id : item.url;
  }

  function applyPrefixProvider(providerId, nextValue = null) {
    const nextIdx = orderedProviders.findIndex((p) => p.id === providerId);
    if (nextIdx === -1) return;
    if (typeof nextValue === "string") {
      proxy.value = nextValue;
      proxy.setSelectionRange(nextValue.length, nextValue.length);
      closeAutocomplete();
      sync();
      scheduleAutocomplete();
      return;
    }
    if (activeProviderIdx !== nextIdx || !isTempPrefixProvider) {
      activeProviderIdx = nextIdx;
      targetScrollPos = nextIdx;
      isTempPrefixProvider = true;
      syncProviderIcon();
      updateReelVisual(targetScrollPos);
    }
  }

  function resetTempPrefixProvider() {
    activePrefixLength = 0;
    if (!isTempPrefixProvider) return;
    const defaultIdx = orderedProviders.findIndex(
      (p) => p.id === lastDefaultProviderId,
    );
    const nextIdx = defaultIdx >= 0 ? defaultIdx : 0;
    isTempPrefixProvider = false;
    activeProviderIdx = nextIdx;
    targetScrollPos = nextIdx;
    syncProviderIcon();
    updateReelVisual(targetScrollPos);
  }

  function syncPrefixState() {
    const matched = resolvePrefixCommand(proxy.value);
    if (matched) {
      activePrefixLength = matched.prefixLength;
      applyPrefixProvider(matched.provider.id);
    } else {
      resetTempPrefixProvider();
    }
  }

  function updateAutocompleteSelection() {
    if (!autocompleteEl) return;
    let activeRow = null;
    autocompleteItems.forEach((item, idx) => {
      const entry = autocompleteRows.get(getAutocompleteKey(item));
      if (!entry) return;
      const isSelected = idx === selectedSuggestionIdx;
      entry.el.classList.toggle("is-selected", isSelected);
      if (isSelected) activeRow = entry.el;
    });
    if (autocompleteHighlightEl) {
      if (activeRow) {
        const wasHidden =
          autocompleteHighlightEl.style.opacity !== "1";
        if (wasHidden) {
          autocompleteHighlightEl.style.transition = "none";
          autocompleteHighlightEl.style.height = `${activeRow.offsetHeight}px`;
          autocompleteHighlightEl.style.transform = `translateY(${activeRow.offsetTop}px)`;
          void autocompleteHighlightEl.offsetHeight;
          autocompleteHighlightEl.style.transition = "";
        } else {
          autocompleteHighlightEl.style.height = `${activeRow.offsetHeight}px`;
          autocompleteHighlightEl.style.transform = `translateY(${activeRow.offsetTop}px)`;
        }
        autocompleteHighlightEl.style.opacity = "1";
      } else {
        autocompleteHighlightEl.style.opacity = "0";
      }
    }
  }

  function createAutocompleteRow(item, idx) {
    const isPrefix = item.type === "prefix";
    const key = getAutocompleteKey(item);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-autocomplete-item";
    btn.dataset.index = String(idx);
    btn.dataset.key = key;
    btn.setAttribute("role", "option");

    const faviconWrap = document.createElement("span");
    faviconWrap.className = "search-autocomplete-favicon";

    const fallbackIcon = document.createElement("span");
    fallbackIcon.className = "search-autocomplete-favicon-fallback";
    fallbackIcon.innerHTML = isPrefix
      ? Icons[item.icon] || Icons.search || ""
      : Icons.directUrl || "";
    faviconWrap.appendChild(fallbackIcon);

    if (!isPrefix) {
      const faviconUrl = getFaviconUrl(item.url);
      if (faviconUrl) {
        const img = document.createElement("img");
        img.className = "search-autocomplete-favicon-img";
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("load", () => {
          fallbackIcon.hidden = true;
        });
        img.addEventListener("error", () => {
          img.remove();
          fallbackIcon.hidden = false;
        });
        img.src = faviconUrl;
        faviconWrap.appendChild(img);
      }
    }

    const textWrap = document.createElement("span");
    textWrap.className = "search-autocomplete-text";

    const titleEl = document.createElement("span");
    titleEl.className = "search-autocomplete-title";
    titleEl.textContent = isPrefix ? item.prefix : item.title;

    const urlEl = document.createElement("span");
    urlEl.className = "search-autocomplete-url";
    urlEl.textContent = isPrefix ? item.title : item.displayUrl;

    textWrap.append(titleEl, urlEl);

    const badgeWrap = document.createElement("span");
    badgeWrap.className = "search-autocomplete-badge";
    if (!isPrefix) {
      badgeWrap.innerHTML =
        item.source === "bookmark"
          ? Icons.autocompleteBookmark || ""
          : Icons.autocompleteHistory || "";
    }

    btn.append(faviconWrap, textWrap, badgeWrap);
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    btn.addEventListener("mouseenter", () => {
      selectedSuggestionIdx = Number(btn.dataset.index);
      selectionSource = "mouse";
      updateAutocompleteSelection();
    });
    btn.addEventListener("click", () => {
      if (isPrefix) {
        applyPrefixProvider(item.providerId, `${item.prefix} `);
      } else {
        openTargetUrl(item.url);
      }
    });
    return btn;
  }

  function renderAutocomplete(items) {
    if (!autocompleteEl) return;
    if (!items.length || !isFocused || isPickerOpen) {
      closeAutocomplete();
      return;
    }

    const wasOpen = autocompleteEl.classList.contains("is-open");
    const prevHeight = wasOpen ? autocompleteEl.offsetHeight : 0;

    // FLIP First: snapshot current visual positions of visible non-exiting rows
    const firstRects = new Map();
    if (wasOpen) {
      for (const [key, entry] of autocompleteRows.entries()) {
        if (!entry.el.classList.contains("is-exiting")) {
          firstRects.set(key, entry.el.getBoundingClientRect());
        }
      }
    }

    if (!autocompleteHighlightEl || !autocompleteHighlightEl.isConnected) {
      autocompleteHighlightEl = document.createElement("div");
      autocompleteHighlightEl.className = "search-autocomplete-highlight";
      autocompleteHighlightEl.setAttribute("aria-hidden", "true");
      autocompleteEl.prepend(autocompleteHighlightEl);
    }

    const nextKeys = new Set(items.map(getAutocompleteKey));

    // Read all exiting geometries BEFORE mutating position:absolute so later items don't collapse upward
    const toExit = [];
    for (const [key, entry] of autocompleteRows.entries()) {
      if (nextKeys.has(key)) continue;
      if (entry.el.classList.contains("is-exiting")) continue;
      const el = entry.el;
      toExit.push({
        key,
        entry,
        el,
        top: el.offsetTop,
        left: el.offsetLeft,
        width: el.offsetWidth,
      });
    }

    for (const { key, entry, el, top, left, width } of toExit) {
      el.style.position = "absolute";
      el.style.top = `${top}px`;
      el.style.left = `${left}px`;
      el.style.width = `${width}px`;
      el.style.transition = "";
      el.style.transform = "";
      el.style.opacity = "";
      void el.offsetWidth;
      el.classList.remove("is-selected");
      el.classList.add("is-exiting");
      entry.exitTimer = setTimeout(() => {
        el.remove();
        autocompleteRows.delete(key);
      }, 190);
    }

    autocompleteItems = items;
    selectedSuggestionIdx = -1;
    selectionSource = null;

    const newEntries = [];
    const survivingEntries = [];

    items.forEach((item, idx) => {
      const key = getAutocompleteKey(item);
      let entry = autocompleteRows.get(key);
      if (entry) {
        clearTimeout(entry.exitTimer);
        entry.exitTimer = null;
        entry.el.classList.remove("is-exiting");
        entry.el.style.position = "";
        entry.el.style.top = "";
        entry.el.style.left = "";
        entry.el.style.width = "";
        // Clear any in-flight transform/opacity before measuring Last position
        entry.el.style.transition = "none";
        entry.el.style.transform = "";
        entry.el.style.opacity = "";
        entry.el.dataset.index = String(idx);
        // Sync source badge in case bookmark/history status changed
        const badgeWrap = entry.el.querySelector(".search-autocomplete-badge");
        if (badgeWrap && item.type !== "prefix") {
          badgeWrap.innerHTML =
            item.source === "bookmark"
              ? Icons.autocompleteBookmark || ""
              : Icons.autocompleteHistory || "";
        }
        survivingEntries.push({ key, el: entry.el });
      } else {
        const el = createAutocompleteRow(item, idx);
        entry = { el, exitTimer: null };
        autocompleteRows.set(key, entry);
        newEntries.push({ key, el });
      }
      autocompleteEl.appendChild(entry.el);
    });

    // Measure natural target height and Last rects without transitions
    clearTimeout(autocompleteHeightTimer);
    autocompleteEl.style.transition = "none";
    autocompleteEl.style.height = "auto";
    autocompleteEl.classList.add("is-open");
    const targetHeight = autocompleteEl.offsetHeight;

    const lastRects = new Map();
    if (wasOpen) {
      for (const { key, el } of survivingEntries) {
        lastRects.set(key, el.getBoundingClientRect());
      }
    }

    // Invert: apply initial transforms/opacity before painting
    if (wasOpen) {
      for (const { key, el } of survivingEntries) {
        const first = firstRects.get(key);
        const last = lastRects.get(key);
        if (!first || !last) continue;
        const dy = first.top - last.top;
        if (Math.abs(dy) > 0.5) {
          el.style.transition = "none";
          el.style.transform = `translateY(${dy}px)`;
        }
      }
    }
    for (const { el } of newEntries) {
      el.style.transition = "none";
      el.style.opacity = "0";
      el.style.transform = "scale(0.95)";
    }

    if (wasOpen && prevHeight > 0 && Math.abs(prevHeight - targetHeight) > 0.5) {
      autocompleteEl.style.height = `${prevHeight}px`;
    } else {
      autocompleteEl.style.height = "";
    }

    // Commit inverted state in a single synchronous reflow before Play
    void autocompleteEl.offsetHeight;

    if (autocompleteFlipRaf) cancelAnimationFrame(autocompleteFlipRaf);
    autocompleteFlipRaf = requestAnimationFrame(() => {
      autocompleteFlipRaf = null;
      autocompleteEl.style.transition = "";
      if (wasOpen && prevHeight > 0 && Math.abs(prevHeight - targetHeight) > 0.5) {
        autocompleteEl.style.height = `${targetHeight}px`;
        autocompleteHeightTimer = setTimeout(() => {
          autocompleteEl.style.height = "";
        }, 290);
      }

      for (const { el } of survivingEntries) {
        el.style.transition =
          "transform 0.24s var(--expo_out), opacity 0.18s var(--ease_out)";
        el.style.transform = "";
      }
      for (const { el } of newEntries) {
        el.style.transition =
          "transform 0.22s var(--expo_out), opacity 0.18s var(--ease_out)";
        el.style.opacity = "";
        el.style.transform = "";
      }
    });

    updateAutocompleteSelection();
  }

  function scheduleAutocomplete() {
    if (!autocompleteEl) return;
    const config = getSettings().widgets?.search?.config || {};
    const useBookmarks = Boolean(config.autocomplete_bookmarks);
    const useHistory = Boolean(config.autocomplete_history);
    const query = proxy.value.trim();

    if (!isFocused || isPickerOpen || !query) {
      closeAutocomplete();
      return;
    }

    const matchedPrefix = resolvePrefixCommand(proxy.value);
    if (matchedPrefix?.hasSpace) {
      const subQuery = matchedPrefix.restQuery.trim();
      if (!subQuery || (!useBookmarks && !useHistory)) {
        closeAutocomplete();
        return;
      }
      clearTimeout(autocompleteDebounceTimer);
      const reqId = ++autocompleteReqSeq;
      autocompleteDebounceTimer = setTimeout(async () => {
        const results = await fetchAutocompleteSuggestions(subQuery, {
          bookmarks: useBookmarks,
          history: useHistory,
        });
        if (reqId !== autocompleteReqSeq) return;
        renderAutocomplete(results);
      }, 70);
      return;
    }

    if (query.startsWith("/") && !/\s/.test(query)) {
      clearTimeout(autocompleteDebounceTimer);
      autocompleteReqSeq += 1;
      renderAutocomplete(getPrefixSuggestions(query));
      return;
    }

    if (!useBookmarks && !useHistory) {
      closeAutocomplete();
      return;
    }

    clearTimeout(autocompleteDebounceTimer);
    const reqId = ++autocompleteReqSeq;
    autocompleteDebounceTimer = setTimeout(async () => {
      const results = await fetchAutocompleteSuggestions(query, {
        bookmarks: useBookmarks,
        history: useHistory,
      });
      if (reqId !== autocompleteReqSeq) return;
      renderAutocomplete(results);
    }, 70);
  }

  function openPicker() {
    if (isPickerOpen) return;
    closeAutocomplete();
    isPickerOpen = true;
    targetScrollPos = activeProviderIdx;
    updateReelVisual(targetScrollPos);
    box.classList.add("is-picker-open");
  }

  function closePicker() {
    clearTimeout(arrowAutoCloseTimer);
    clearTimeout(wheelSnapTimer);
    if (!isPickerOpen) return;
    targetScrollPos = activeProviderIdx;
    updateReelVisual(targetScrollPos);
    isPickerOpen = false;
    box.classList.remove("is-picker-open");
  }

  function stepProvider(delta) {
    const base = Math.round(targetScrollPos);
    const next = Math.max(
      0,
      Math.min(orderedProviders.length - 1, base + delta),
    );
    targetScrollPos = next;
    applyReelPosition(true);
  }

  function flashArrow(dir) {
    const el = dir < 0 ? arrowUpEl : arrowDownEl;
    if (!el) return;
    el.classList.remove("is-lit");
    void el.offsetWidth;
    el.classList.add("is-lit");
    void el.offsetWidth;
    requestAnimationFrame(() => {
      el.classList.remove("is-lit");
    });
  }

  buildProviderReel();

  function layoutCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = box.clientWidth + OVERFLOW_X * 2;
    const cssH = box.clientHeight + OVERFLOW_Y * 2;

    canvas.style.left = `-${OVERFLOW_X}px`;
    canvas.style.top = `-${OVERFLOW_Y}px`;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function measureTextWidth(str, font = FONT) {
    ctx.font = font;
    return ctx.measureText(str).width;
  }

  function getGraphemes(str) {
    if (!str) return [];
    if (segmenter) {
      return Array.from(segmenter.segment(str), (seg) => ({
        ch: seg.segment,
        index: seg.index,
        end: seg.index + seg.segment.length,
      }));
    }
    const res = [];
    let idx = 0;
    for (const ch of str) {
      res.push({ ch, index: idx, end: idx + ch.length });
      idx += ch.length;
    }
    return res;
  }

  function getGraphemeLayout(graphemes, boldUntil = activePrefixLength) {
    const positions = [0];
    let acc = 0;
    for (let i = 0; i < graphemes.length; i++) {
      const g = graphemes[i];
      const font = g.index < boldUntil ? FONT_PREFIX : FONT;
      acc += measureTextWidth(g.ch, font);
      if (boldUntil > 0 && g.index === boldUntil) {
        acc += PREFIX_TAIL_GAP;
      }
      positions.push(acc);
    }
    return positions;
  }

  function getXForUtf16Index(graphemes, positions, utf16Index) {
    for (let i = 0; i < graphemes.length; i++) {
      if (utf16Index <= graphemes[i].index) return positions[i];
    }
    return positions[graphemes.length];
  }

  function getCaretIndexFromClick(clientX) {
    const rect = box.getBoundingClientRect();
    const localX = clientX - rect.left - currentPadX + scrollVisualX;
    const text = proxy.value;
    const graphemes = getGraphemes(text);
    const positions = getGraphemeLayout(graphemes);

    if (localX <= 0) return 0;
    for (let i = 0; i < graphemes.length; i++) {
      const mid = (positions[i] + positions[i + 1]) / 2;
      if (localX < mid) return graphemes[i].index;
    }
    return text.length;
  }

  function updateScrollAndCaretTarget() {
    const text = proxy.value;
    const graphemes = getGraphemes(text);
    const positions = getGraphemeLayout(graphemes);
    const selStart = proxy.selectionStart ?? text.length;
    const selEnd = proxy.selectionEnd ?? text.length;
    const caretPos =
      proxy.selectionDirection === "backward" ? selStart : selEnd;
    const caretGap =
      text.length > 0 && caretPos === text.length && selStart === selEnd
        ? CARET_GAP
        : 0;
    const caretRawX =
      getXForUtf16Index(graphemes, positions, caretPos) + caretGap;
    const totalW =
      positions[graphemes.length] + (text.length > 0 ? CARET_GAP : 0);
    const boxInnerW = Math.max(
      0,
      box.clientWidth - currentPadX - INNER_PAD_RIGHT,
    );
    const maxScroll = Math.max(0, totalW - boxInnerW);

    if (caretRawX - scrollTargetX > boxInnerW) {
      scrollTargetX = caretRawX - boxInnerW;
    } else if (caretRawX - scrollTargetX < 0) {
      scrollTargetX = caretRawX;
    }
    scrollTargetX = Math.max(0, Math.min(scrollTargetX, maxScroll));

    caretRawTargetX = caretRawX;
  }

  function resetBlink() {
    lastBlinkReset = performance.now();
  }

  function buildPlaceholderMorph(fromStr, toStr, now) {
    const fromG = getGraphemes(fromStr);
    const toG = getGraphemes(toStr);
    const usedTo = new Array(toG.length).fill(false);
    const moving = [];
    const outgoing = [];
    const incoming = [];

    for (const fg of fromG) {
      const fromX = measureTextWidth(fromStr.slice(0, fg.index));
      let matchIdx = -1;
      for (let j = 0; j < toG.length; j++) {
        if (!usedTo[j] && toG[j].ch === fg.ch) {
          matchIdx = j;
          break;
        }
      }
      if (matchIdx !== -1) {
        usedTo[matchIdx] = true;
        const toX = measureTextWidth(toStr.slice(0, toG[matchIdx].index));
        moving.push({ ch: fg.ch, fromX, toX });
      } else {
        outgoing.push({ ch: fg.ch, x: fromX });
      }
    }

    for (let j = 0; j < toG.length; j++) {
      if (!usedTo[j]) {
        incoming.push({
          ch: toG[j].ch,
          x: measureTextWidth(toStr.slice(0, toG[j].index)),
        });
      }
    }

    return { start: now, moving, outgoing, incoming };
  }

  function updateCharAnimations(now) {
    const nextText = proxy.value;
    if (nextText === prevText) return;

    const nextGraphemes = getGraphemes(nextText);

    if (getSettings().widgets?.search?.config?.reduce_animation) {
      charAnims = new Array(nextGraphemes.length).fill(null);
      charOffsetX = new Array(nextGraphemes.length).fill(0);
      pendingDeletes = [];
      fallingChars = [];
      prevText = nextText;
      prevGraphemes = nextGraphemes;
      return;
    }

    let prefix = 0;
    while (
      prefix < prevGraphemes.length &&
      prefix < nextGraphemes.length &&
      prevGraphemes[prefix].ch === nextGraphemes[prefix].ch
    ) {
      prefix++;
    }

    let prevSuffix = prevGraphemes.length;
    let nextSuffix = nextGraphemes.length;
    while (
      prevSuffix > prefix &&
      nextSuffix > prefix &&
      prevGraphemes[prevSuffix - 1].ch === nextGraphemes[nextSuffix - 1].ch
    ) {
      prevSuffix--;
      nextSuffix--;
    }

    let imeReplacedCount = 0;
    if (nextSuffix > prefix && pendingDeletes.length > 0) {
      const stillPending = [];
      for (const item of pendingDeletes) {
        if (now - item.deleteAt <= IME_GUARD_MS) {
          imeReplacedCount++;
        } else {
          stillPending.push(item);
        }
      }
      pendingDeletes = stillPending;
    }

    const prevPositions = getGraphemeLayout(prevGraphemes);
    const nextPositions = getGraphemeLayout(nextGraphemes);

    if (prevSuffix > prefix && nextSuffix === prefix && !isComposing) {
      const currentOriginX = OVERFLOW_X + currentPadX - scrollVisualX;
      for (let i = prefix; i < prevSuffix; i++) {
        const g = prevGraphemes[i];
        pendingDeletes.push({
          ch: g.ch,
          x: currentOriginX + prevPositions[i],
          w: measureTextWidth(g.ch),
          rot: ((Math.random() * 90 - 45) * Math.PI) / 180,
          deleteAt: now,
        });
      }
    }

    const nextAnims = new Array(nextGraphemes.length).fill(null);
    const nextOffsets = new Array(nextGraphemes.length).fill(0);
    for (let i = 0; i < prefix; i++) {
      nextAnims[i] = charAnims[i] || null;
      nextOffsets[i] = charOffsetX[i] || 0;
    }
    const skipFadeCount = isComposing ? nextSuffix - prefix : imeReplacedCount;
    for (let i = prefix; i < nextSuffix; i++) {
      if (i - prefix < skipFadeCount) {
        nextAnims[i] = null;
      } else {
        nextAnims[i] = { start: now };
      }
    }
    for (let i = nextSuffix; i < nextGraphemes.length; i++) {
      const oldIdx = prevSuffix + (i - nextSuffix);
      nextAnims[i] = charAnims[oldIdx] || null;
      const oldX = prevPositions[oldIdx];
      const newX = nextPositions[i];
      nextOffsets[i] = (charOffsetX[oldIdx] || 0) + (oldX - newX);
    }

    charAnims = nextAnims;
    charOffsetX = nextOffsets;
    prevText = nextText;
    prevGraphemes = nextGraphemes;
  }

  function draw(now) {
    const cssW = box.clientWidth + OVERFLOW_X * 2;
    const cssH = box.clientHeight + OVERFLOW_Y * 2;
    const searchConfig = getSettings().widgets?.search?.config || {};
    const reduceAnim = Boolean(searchConfig.reduce_animation);

    if (reduceAnim) {
      scrollVisualX = scrollTargetX;
      caretVisualX = caretRawTargetX;
      pendingDeletes = [];
      fallingChars = [];
    } else {
      scrollVisualX += (scrollTargetX - scrollVisualX) * 0.24;
      if (Math.abs(scrollTargetX - scrollVisualX) < 0.25) {
        scrollVisualX = scrollTargetX;
      }

      caretVisualX += (caretRawTargetX - caretVisualX) * 0.36;
      if (Math.abs(caretRawTargetX - caretVisualX) < 0.2) {
        caretVisualX = caretRawTargetX;
      }
    }

    const targetPadX = isFocused || isPickerOpen ? FOCUS_PAD_X : REST_PAD_X;
    currentPadX += (targetPadX - currentPadX) * 0.24;
    if (Math.abs(targetPadX - currentPadX) < 0.15) {
      currentPadX = targetPadX;
    }

    const dpr = window.devicePixelRatio || 1;
    const textOriginX = OVERFLOW_X + currentPadX - scrollVisualX;
    const centerY = cssH / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = FONT;
    ctx.textBaseline = "alphabetic";

    const capAscent = ctx.measureText("H").actualBoundingBoxAscent || 11.5;
    const textY = centerY + capAscent / 2;

    const text = proxy.value;
    const graphemes = getGraphemes(text);
    const positions = getGraphemeLayout(graphemes);
    const selStart = proxy.selectionStart ?? 0;
    const selEnd = proxy.selectionEnd ?? 0;

    // Selection highlight
    const hasSelection = isFocused && selStart !== selEnd;
    let selTargetStartX = caretRawTargetX;
    let selTargetEndX = caretRawTargetX;
    let selTargetAlpha = 0;

    if (hasSelection) {
      const start = Math.min(selStart, selEnd);
      const end = Math.max(selStart, selEnd);
      selTargetStartX = getXForUtf16Index(graphemes, positions, start);
      selTargetEndX = getXForUtf16Index(graphemes, positions, end);
      selTargetAlpha = 1;

      if (selVisualAlpha < 0.04) {
        const anchorX =
          proxy.selectionDirection === "backward"
            ? selTargetEndX
            : selTargetStartX;
        selVisualStartX = anchorX;
        selVisualEndX = anchorX;
      }
    }

    if (reduceAnim) {
      selVisualAlpha = selTargetAlpha;
      selVisualStartX = selTargetStartX;
      selVisualEndX = selTargetEndX;
    } else {
      selVisualAlpha += (selTargetAlpha - selVisualAlpha) * 0.28;
      selVisualStartX += (selTargetStartX - selVisualStartX) * 0.34;
      selVisualEndX += (selTargetEndX - selVisualEndX) * 0.34;
      if (Math.abs(selTargetAlpha - selVisualAlpha) < 0.01) {
        selVisualAlpha = selTargetAlpha;
      }
      if (Math.abs(selTargetStartX - selVisualStartX) < 0.2) {
        selVisualStartX = selTargetStartX;
      }
      if (Math.abs(selTargetEndX - selVisualEndX) < 0.2) {
        selVisualEndX = selTargetEndX;
      }
    }

    if (selVisualAlpha > 0 && selVisualEndX - selVisualStartX > 0.5) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${0.22 * selVisualAlpha})`;
      ctx.beginPath();
      ctx.roundRect(
        textOriginX + selVisualStartX,
        centerY - 12,
        selVisualEndX - selVisualStartX,
        24,
        6,
      );
      ctx.fill();
      ctx.restore();
    }

    // Placeholder character-level morph (or fade-out/in when reduce_animation is enabled)
    const placeholderTarget = text.length === 0 && !isPickerOpen ? 1 : 0;
    if (reduceAnim) {
      placeholderAlpha = placeholderTarget;
    } else {
      placeholderAlpha += (placeholderTarget - placeholderAlpha) * 0.16;
      if (Math.abs(placeholderTarget - placeholderAlpha) < 0.01) {
        placeholderAlpha = placeholderTarget;
      }
    }

    const placeholders = getPlaceholders();
    const customPlaceholder = (searchConfig.custom_placeholder || "").trim();
    const disableRoll = Boolean(searchConfig.disable_placeholder_roll);

    if (
      !customPlaceholder &&
      !disableRoll &&
      text.length === 0 &&
      now - lastPlaceholderSwitch >= PLACEHOLDER_INTERVAL
    ) {
      const fromStr = placeholders[placeholderIdx % placeholders.length];
      placeholderIdx = (placeholderIdx + 1) % placeholders.length;
      const toStr = placeholders[placeholderIdx];
      placeholderMorph = reduceAnim
        ? { mode: "fade", start: now, fromStr, toStr }
        : buildPlaceholderMorph(fromStr, toStr, now);
      lastPlaceholderSwitch = now;
    }

    if (placeholderAlpha > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      const baseX = OVERFLOW_X + currentPadX;

      if (customPlaceholder) {
        placeholderMorph = null;
        ctx.globalAlpha = placeholderAlpha;
        ctx.fillText(customPlaceholder, baseX, textY);
      } else if (disableRoll) {
        placeholderIdx = 0;
        placeholderMorph = null;
        ctx.globalAlpha = placeholderAlpha;
        ctx.fillText(placeholders[0], baseX, textY);
      } else if (placeholderMorph?.mode === "fade") {
        const t = Math.min(
          1,
          (now - placeholderMorph.start) / PLACEHOLDER_MORPH_MS,
        );
        if (t < 0.5) {
          ctx.globalAlpha = placeholderAlpha * (1 - t * 2);
          ctx.fillText(placeholderMorph.fromStr, baseX, textY);
        } else {
          ctx.globalAlpha = placeholderAlpha * ((t - 0.5) * 2);
          ctx.fillText(placeholderMorph.toStr, baseX, textY);
        }
        if (t >= 1) placeholderMorph = null;
      } else if (placeholderMorph) {
        const t = Math.min(
          1,
          (now - placeholderMorph.start) / PLACEHOLDER_MORPH_MS,
        );
        const ease = t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);

        for (const item of placeholderMorph.outgoing) {
          ctx.globalAlpha = placeholderAlpha * (1 - ease);
          ctx.fillText(item.ch, baseX + item.x, textY - 6 * ease);
        }
        for (const item of placeholderMorph.moving) {
          ctx.globalAlpha = placeholderAlpha;
          const mx = item.fromX + (item.toX - item.fromX) * ease;
          ctx.fillText(item.ch, baseX + mx, textY);
        }
        for (const item of placeholderMorph.incoming) {
          ctx.globalAlpha = placeholderAlpha * ease;
          ctx.fillText(item.ch, baseX + item.x, textY + 6 * (1 - ease));
        }

        if (t >= 1) placeholderMorph = null;
      } else {
        ctx.globalAlpha = placeholderAlpha;
        ctx.fillText(placeholders[placeholderIdx % placeholders.length], baseX, textY);
      }

      ctx.restore();
    }

    if (text.length > 0) {
      if (activePrefixLength > 0) {
        const prefixEndX = getXForUtf16Index(
          graphemes,
          positions,
          activePrefixLength,
        );
        if (prefixEndX > 0) {
          const padX = 5;
          const pillH = 24;
          ctx.save();
          ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
          ctx.beginPath();
          ctx.roundRect(
            textOriginX - padX,
            centerY - pillH / 2,
            prefixEndX + padX * 2,
            pillH,
            7,
          );
          ctx.fill();
          ctx.restore();
        }
      }

      for (let i = 0; i < graphemes.length; i++) {
        const g = graphemes[i];
        let ox = reduceAnim ? 0 : charOffsetX[i] || 0;
        if (ox !== 0) {
          ox += (0 - ox) * 0.26;
          if (Math.abs(ox) < 0.2) ox = 0;
          charOffsetX[i] = ox;
        } else if (reduceAnim) {
          charOffsetX[i] = 0;
        }

        const charX = textOriginX + positions[i] + ox;
        const anim = reduceAnim ? null : charAnims[i];
        let alpha = 1;

        if (anim) {
          const t = Math.min(1, (now - anim.start) / FADE_IN_DURATION);
          alpha = 1 - Math.pow(1 - t, 3);
          if (t >= 1) charAnims[i] = null;
        } else if (reduceAnim) {
          charAnims[i] = null;
        }

        ctx.save();
        ctx.font = g.index < activePrefixLength ? FONT_PREFIX : FONT;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(g.ch, charX, textY);
        ctx.restore();
      }
    }

    if (pendingDeletes.length > 0) {
      const stillPending = [];
      for (const item of pendingDeletes) {
        if (now - item.deleteAt >= IME_GUARD_MS) {
          fallingChars.push({
            ch: item.ch,
            x: item.x,
            w: item.w,
            rot: item.rot,
            start: now,
          });
        } else {
          stillPending.push(item);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(item.ch, item.x, textY);
        }
      }
      pendingDeletes = stillPending;
    }

    if (fallingChars.length > 0) {
      fallingChars = fallingChars.filter((item) => {
        const t = Math.min(1, (now - item.start) / FALL_OUT_DURATION);
        const ease = t * t;
        const alpha = 1 - ease;
        const offsetY = FALL_OFFSET * ease;
        const scale = 1 - 0.1 * ease;
        const angle = item.rot * ease;
        const pivotX = item.x + item.w / 2;
        const pivotY = centerY + offsetY;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(pivotX, pivotY);
        ctx.rotate(angle);
        ctx.scale(scale, scale);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(item.ch, -item.w / 2, textY - centerY);
        ctx.restore();

        return t < 1;
      });
    }

    if (isFocused) {
      const phase = ((now - lastBlinkReset) % 1100) / 1100;
      const caretAlpha = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
      const cx = textOriginX + caretVisualX;

      ctx.save();
      ctx.globalAlpha = caretAlpha;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(
        cx - CARET_WIDTH / 2,
        centerY - 11,
        CARET_WIDTH,
        22,
        CARET_RADIUS,
      );
      ctx.fill();
      ctx.restore();
    }

    // Soft alpha fade on left/right inner edges using destination-out
    const fadeTop = OVERFLOW_Y;
    const fadeH = box.clientHeight;
    const leftFadeStart = currentPadX - 14;
    const leftFadeEnd = currentPadX;
    const rightFadeW = 20;

    ctx.save();
    ctx.globalCompositeOperation = "destination-out";

    const leftGrad = ctx.createLinearGradient(leftFadeStart, 0, leftFadeEnd, 0);
    leftGrad.addColorStop(0, "rgba(0, 0, 0, 1)");
    leftGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = leftGrad;
    ctx.fillRect(0, fadeTop, leftFadeEnd, fadeH);

    const rightGrad = ctx.createLinearGradient(cssW - rightFadeW, 0, cssW, 0);
    rightGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
    rightGrad.addColorStop(0.55, "rgba(0, 0, 0, 0.85)");
    rightGrad.addColorStop(1, "rgba(0, 0, 0, 1)");
    ctx.fillStyle = rightGrad;
    ctx.fillRect(cssW - rightFadeW, fadeTop, rightFadeW, fadeH);
    ctx.restore();

    rafId = requestAnimationFrame(draw);
  }

  function sync() {
    syncPrefixState();
    const nextDirectUrl = parseDirectUrl(proxy.value);
    if (nextDirectUrl !== directUrl) {
      directUrl = nextDirectUrl;
      box.classList.toggle("is-direct-url", Boolean(directUrl));
      if (directUrl && isPickerOpen) {
        closePicker();
      }
      syncProviderIcon();
    }
    updateCharAnimations(performance.now());
    updateScrollAndCaretTarget();
    resetBlink();
  }

  function submitSearch() {
    const raw = proxy.value.trim();
    if (!raw) return;
    const matchedPrefix = resolvePrefixCommand(proxy.value);
    if (matchedPrefix) {
      const subQuery = matchedPrefix.restQuery.trim();
      if (!subQuery) return;
      const targetUrl =
        parseDirectUrl(subQuery) ||
        `${matchedPrefix.provider.url}${encodeURIComponent(subQuery)}`;
      openTargetUrl(targetUrl);
      return;
    }
    const provider = orderedProviders[activeProviderIdx] || orderedProviders[0];
    const targetUrl =
      parseDirectUrl(raw) || `${provider.url}${encodeURIComponent(raw)}`;
    openTargetUrl(targetUrl);
  }

  const onBoxMousedown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".search-provider-slot, .search-provider-reel")) {
      return;
    }
    closePicker();
    e.preventDefault();
    proxy.focus();
    const idx = getCaretIndexFromClick(e.clientX);
    isDragging = true;
    dragAnchorIdx = idx;
    proxy.setSelectionRange(idx, idx);
    sync();
  };

  const onSlotClick = (e) => {
    e.stopPropagation();
    proxy.focus();
  };
  const onWheelStep = (e) => {
    if (directUrl) return;
    if (!isFocused && !isPickerOpen) return;
    e.preventDefault();
    openPicker();
    if (e.deltaY === 0) return;
    flashArrow(e.deltaY < 0 ? -1 : 1);

    if (Math.abs(e.deltaY) >= 50) {
      // Discrete mouse wheel notch: step by exact integer to avoid overshoot/snap-back
      clearTimeout(wheelSnapTimer);
      targetScrollPos = Math.max(
        0,
        Math.min(
          orderedProviders.length - 1,
          Math.round(targetScrollPos) + Math.sign(e.deltaY),
        ),
      );
      applyReelPosition();
      clearTimeout(arrowAutoCloseTimer);
      arrowAutoCloseTimer = setTimeout(() => closePicker(), 1200);
    } else {
      // Fine trackpad gesture: accumulate smoothly and snap after idle
      targetScrollPos = Math.max(
        0,
        Math.min(orderedProviders.length - 1, targetScrollPos + e.deltaY / 72),
      );
      applyReelPosition();
      clearTimeout(wheelSnapTimer);
      clearTimeout(arrowAutoCloseTimer);
      wheelSnapTimer = setTimeout(() => {
        targetScrollPos = Math.round(targetScrollPos);
        applyReelPosition();
        arrowAutoCloseTimer = setTimeout(() => closePicker(), 1200);
      }, 110);
    }
  };

  const onWindowMousemove = (e) => {
    if (!isDragging) return;
    const curIdx = getCaretIndexFromClick(e.clientX);
    const start = Math.min(dragAnchorIdx, curIdx);
    const end = Math.max(dragAnchorIdx, curIdx);
    const dir = curIdx < dragAnchorIdx ? "backward" : "forward";
    proxy.setSelectionRange(start, end, dir);
    sync();
  };

  const onWindowMouseup = () => {
    isDragging = false;
  };

  const onBoxFocus = () => proxy.focus();
  const onProxyFocus = () => {
    isFocused = true;
    box.classList.add("is-focused");
    sync();
    scheduleAutocomplete();
  };
  const onProxyBlur = () => {
    isFocused = false;
    box.classList.remove("is-focused");
    closePicker();
    closeAutocomplete();
  };
  const onProxyInput = () => {
    sync();
    scheduleAutocomplete();
  };
  const onProxyKeydown = (e) => {
    resetBlink();
    const isAutocompleteOpen =
      autocompleteItems.length > 0 &&
      autocompleteEl?.classList.contains("is-open");

    if (e.key === "Tab" && isAutocompleteOpen && !isComposing) {
      e.preventDefault();
      const target =
        selectedSuggestionIdx >= 0
          ? autocompleteItems[selectedSuggestionIdx]
          : autocompleteItems[0];
      if (!target) return;
      if (target.type === "prefix") {
        applyPrefixProvider(target.providerId, `${target.prefix} `);
      } else {
        const filled = target.displayUrl || target.url || "";
        proxy.value = filled;
        proxy.setSelectionRange(filled.length, filled.length);
        sync();
        scheduleAutocomplete();
      }
      return;
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (isAutocompleteOpen) {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const count = autocompleteItems.length;
        selectedSuggestionIdx =
          selectedSuggestionIdx < 0
            ? delta > 0
              ? 0
              : count - 1
            : (selectedSuggestionIdx + delta + count) % count;
        selectionSource = "keyboard";
        updateAutocompleteSelection();
        return;
      }
      if (directUrl) return;
      e.preventDefault();
      openPicker();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      stepProvider(dir);
      flashArrow(dir);
      clearTimeout(arrowAutoCloseTimer);
      arrowAutoCloseTimer = setTimeout(() => closePicker(), 1800);
      return;
    }
    if (e.key === "Escape") {
      if (isAutocompleteOpen) {
        e.preventDefault();
        closeAutocomplete();
        return;
      }
      if (isPickerOpen) {
        e.preventDefault();
        closePicker();
        return;
      }
    }
    if (e.key === "Enter" && !isComposing) {
      e.preventDefault();
      if (isAutocompleteOpen && selectedSuggestionIdx >= 0) {
        const chosen = autocompleteItems[selectedSuggestionIdx];
        if (chosen?.type === "prefix") {
          applyPrefixProvider(chosen.providerId, `${chosen.prefix} `);
          return;
        }
        if (chosen?.url) {
          openTargetUrl(chosen.url);
          return;
        }
      }
      if (isPickerOpen) {
        activeProviderIdx = Math.max(
          0,
          Math.min(orderedProviders.length - 1, Math.round(targetScrollPos)),
        );
        syncProviderIcon();
        closePicker();
      } else {
        submitSearch();
      }
      return;
    }
    if (isPickerOpen && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      closePicker();
    }
  };
  const onCompStart = () => {
    isComposing = true;
  };
  const onCompEnd = () => {
    isComposing = false;
    sync();
  };
  const onSelectionChange = () => {
    if (document.activeElement === proxy) sync();
  };
  const onResize = () => {
    layoutCanvas();
    updateScrollAndCaretTarget();
  };

  const onAutocompleteMouseleave = () => {
    if (selectionSource !== "mouse") return;
    selectedSuggestionIdx = -1;
    selectionSource = null;
    updateAutocompleteSelection();
  };

  box.addEventListener("mousedown", onBoxMousedown);
  box.addEventListener("focus", onBoxFocus);
  box.addEventListener("wheel", onWheelStep, { passive: false });
  providerSlot?.addEventListener("click", onSlotClick);
  autocompleteEl?.addEventListener("mouseleave", onAutocompleteMouseleave);
  proxy.addEventListener("focus", onProxyFocus);
  proxy.addEventListener("blur", onProxyBlur);
  proxy.addEventListener("input", onProxyInput);
  proxy.addEventListener("keyup", sync);
  proxy.addEventListener("keydown", onProxyKeydown);
  proxy.addEventListener("compositionstart", onCompStart);
  proxy.addEventListener("compositionend", onCompEnd);
  proxy.addEventListener("compositionupdate", sync);
  window.addEventListener("mousemove", onWindowMousemove);
  window.addEventListener("mouseup", onWindowMouseup);
  window.addEventListener("resize", onResize);
  document.addEventListener("selectionchange", onSelectionChange);

  const ro = new ResizeObserver(onResize);
  ro.observe(box);

  layoutCanvas();
  updateScrollAndCaretTarget();
  caretVisualX = caretRawTargetX;
  scrollVisualX = scrollTargetX;
  rafId = requestAnimationFrame(draw);

  const unsubWidgets = subscribe("widgets", (widgets) => {
    const nextId = widgets?.search?.config?.provider;
    if (!nextId || nextId === lastDefaultProviderId) return;
    lastDefaultProviderId = nextId;
    const nextOrder = buildOrderedProviders(nextId);
    orderedProviders = nextOrder.providers;
    activeProviderIdx = nextOrder.defaultIndex;
    targetScrollPos = nextOrder.defaultIndex;
    buildProviderReel();
  });

  cleanupSearchFn = () => {
    unsubWidgets();
    if (rafId) cancelAnimationFrame(rafId);
    clearTimeout(arrowAutoCloseTimer);
    clearTimeout(wheelSnapTimer);
    clearTimeout(autocompleteDebounceTimer);
    clearTimeout(autocompleteHeightTimer);
    if (autocompleteFlipRaf) cancelAnimationFrame(autocompleteFlipRaf);
    for (const entry of autocompleteRows.values()) {
      clearTimeout(entry.exitTimer);
    }
    autocompleteRows.clear();
    ro.disconnect();
    box.removeEventListener("mousedown", onBoxMousedown);
    box.removeEventListener("focus", onBoxFocus);
    box.removeEventListener("wheel", onWheelStep);
    providerSlot?.removeEventListener("click", onSlotClick);
    autocompleteEl?.removeEventListener("mouseleave", onAutocompleteMouseleave);
    proxy.removeEventListener("focus", onProxyFocus);
    proxy.removeEventListener("blur", onProxyBlur);
    proxy.removeEventListener("input", onProxyInput);
    proxy.removeEventListener("keyup", sync);
    proxy.removeEventListener("keydown", onProxyKeydown);
    proxy.removeEventListener("compositionstart", onCompStart);
    proxy.removeEventListener("compositionend", onCompEnd);
    proxy.removeEventListener("compositionupdate", sync);
    window.removeEventListener("mousemove", onWindowMousemove);
    window.removeEventListener("mouseup", onWindowMouseup);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("selectionchange", onSelectionChange);
  };
}

/**
 * Stop the Search widget loop and clean up all bound listeners.
 */
export function stopSearchWidget() {
  if (cleanupSearchFn) {
    cleanupSearchFn();
    cleanupSearchFn = null;
  }
}
