import { Icons, renderIcons } from "/src/core/icon.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";

const OVERFLOW_X = 0;
const OVERFLOW_Y = 32;
const REST_PAD_X = 44;
const FOCUS_PAD_X = 56;
const INNER_PAD_RIGHT = 20;
const REEL_ITEM_H = 36;
const FONT =
  '500 15px "Quicksand", "Mulish", sans-serif, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"';

const FADE_IN_DURATION = 220;
const FALL_OUT_DURATION = 240;
const FALL_OFFSET = 28;
const IME_GUARD_MS = 35;
const CARET_WIDTH = 1.5;
const CARET_RADIUS = 0.75;
const CARET_GAP = 2.2;
const PLACEHOLDER_INTERVAL = 5000;
const PLACEHOLDER_MORPH_MS = 520;

const PLACEHOLDERS = [
  "Search something...",
  "Dive into your next idea...",
  "Explore the web...",
  "Ask anything or paste a URL...",
  "What are we discovering today?",
  "Curiosity starts here...",
  "Where to next?",
  "Let your mind wander...",
  "Follow your curiosity...",
  "What's hiding out there?",
  "Every thought leads somewhere...",
  "Ready to explore something new?",
  "Find your next rabbit hole...",
  "Somewhere, something awaits...",
  "What's on your mind?",
];

const SEARCH_PROVIDERS = [
  {
    id: "google",
    label: "Google",
    icon: "providerGoogle",
    url: "https://www.google.com/search?q=",
  },
  {
    id: "duckduckgo",
    label: "DuckDuckGo",
    icon: "providerDuckDuckGo",
    url: "https://duckduckgo.com/?q=",
  },
  {
    id: "bing",
    label: "Bing",
    icon: "providerBing",
    url: "https://www.bing.com/search?q=",
  },
  {
    id: "youtube",
    label: "YouTube",
    icon: "providerYouTube",
    url: "https://www.youtube.com/results?search_query=",
  },
  {
    id: "github",
    label: "GitHub",
    icon: "providerGitHub",
    url: "https://github.com/search?q=",
  },
  {
    id: "reddit",
    label: "Reddit",
    icon: "providerReddit",
    url: "https://www.reddit.com/search/?q=",
  },
  {
    id: "pinterest",
    label: "Pinterest",
    icon: "providerPinterest",
    url: "https://www.pinterest.com/search/pins/?q=",
  },
  {
    id: "spotify",
    label: "Spotify",
    icon: "providerSpotify",
    url: "https://open.spotify.com/search/",
  },
];

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
  const savedProviderId = getSettings().widgets?.search?.config?.provider;
  let activeProviderIdx = Math.max(
    0,
    SEARCH_PROVIDERS.findIndex((p) => p.id === savedProviderId),
  );
  let targetScrollPos = activeProviderIdx;
  let isPickerOpen = false;
  let pickerCloseTimer = null;
  let arrowAutoCloseTimer = null;
  let wheelSnapTimer = null;
  let reelItems = [];

  function syncProviderIconAndPersist(persist = false) {
    const active = SEARCH_PROVIDERS[activeProviderIdx] || SEARCH_PROVIDERS[0];
    if (providerIconEl) {
      providerIconEl.innerHTML = Icons[active.icon] || Icons.search || "";
    }
    reelItems.forEach((el, idx) => {
      el.classList.toggle("is-active", idx === activeProviderIdx);
    });
    if (persist) {
      const currentWidgets = getSettings().widgets;
      saveSettings({
        widgets: {
          ...currentWidgets,
          search: {
            ...currentWidgets?.search,
            config: {
              ...currentWidgets?.search?.config,
              provider: active.id,
            },
          },
        },
      });
    }
  }

  function updateReelVisual(pos) {
    if (!trackEl) return;
    const offsetY = -(pos * REEL_ITEM_H + REEL_ITEM_H / 2);
    trackEl.style.transform = `translateY(${offsetY.toFixed(2)}px)`;
  }

  function buildProviderReel() {
    if (!trackEl) return;
    trackEl.innerHTML = SEARCH_PROVIDERS.map(
      (p, idx) => `
      <div class="search-provider-item${idx === activeProviderIdx ? " is-active" : ""}" data-provider-idx="${idx}">
        ${Icons[p.icon] || ""}
        <span class="search-provider-label">${p.label}</span>
      </div>
    `,
    ).join("");

    reelItems = Array.from(trackEl.querySelectorAll(".search-provider-item"));
    reelItems.forEach((item) => {
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number(item.dataset.providerIdx);
        if (!Number.isNaN(idx)) {
          targetScrollPos = idx;
          activeProviderIdx = idx;
          syncProviderIconAndPersist(true);
        }
        closePicker();
        proxy.focus();
      });
    });

    syncProviderIconAndPersist(false);
    updateReelVisual(targetScrollPos);
  }

  function applyReelPosition(persist = true) {
    updateReelVisual(targetScrollPos);
    const nearestIdx = Math.max(
      0,
      Math.min(SEARCH_PROVIDERS.length - 1, Math.round(targetScrollPos)),
    );
    if (nearestIdx !== activeProviderIdx) {
      activeProviderIdx = nearestIdx;
      syncProviderIconAndPersist(persist);
    }
  }

  function openPicker() {
    clearTimeout(pickerCloseTimer);
    if (isPickerOpen) return;
    isPickerOpen = true;
    targetScrollPos = activeProviderIdx;
    updateReelVisual(targetScrollPos);
    box.classList.add("is-picker-open");
  }

  function closePicker() {
    clearTimeout(pickerCloseTimer);
    clearTimeout(arrowAutoCloseTimer);
    clearTimeout(wheelSnapTimer);
    if (!isPickerOpen) return;
    targetScrollPos = activeProviderIdx;
    updateReelVisual(targetScrollPos);
    isPickerOpen = false;
    box.classList.remove("is-picker-open");
  }

  function scheduleClosePicker(delay = 160) {
    clearTimeout(pickerCloseTimer);
    pickerCloseTimer = setTimeout(() => closePicker(), delay);
  }

  function stepProvider(delta) {
    const base = Math.round(targetScrollPos);
    const next = Math.max(
      0,
      Math.min(SEARCH_PROVIDERS.length - 1, base + delta),
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

  function measureTextWidth(str) {
    ctx.font = FONT;
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

  function getGraphemeLayout(graphemes) {
    const positions = [0];
    let acc = 0;
    for (let i = 0; i < graphemes.length; i++) {
      acc += measureTextWidth(graphemes[i].ch);
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

    scrollVisualX += (scrollTargetX - scrollVisualX) * 0.24;
    if (Math.abs(scrollTargetX - scrollVisualX) < 0.25) {
      scrollVisualX = scrollTargetX;
    }

    caretVisualX += (caretRawTargetX - caretVisualX) * 0.36;
    if (Math.abs(caretRawTargetX - caretVisualX) < 0.2) {
      caretVisualX = caretRawTargetX;
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

    // Placeholder character-level morph (hidden while scrolling provider reel)
    const placeholderTarget = text.length === 0 && !isPickerOpen ? 1 : 0;
    placeholderAlpha += (placeholderTarget - placeholderAlpha) * 0.16;
    if (Math.abs(placeholderTarget - placeholderAlpha) < 0.01) {
      placeholderAlpha = placeholderTarget;
    }

    if (
      text.length === 0 &&
      now - lastPlaceholderSwitch >= PLACEHOLDER_INTERVAL
    ) {
      const fromStr = PLACEHOLDERS[placeholderIdx];
      placeholderIdx = (placeholderIdx + 1) % PLACEHOLDERS.length;
      const toStr = PLACEHOLDERS[placeholderIdx];
      placeholderMorph = buildPlaceholderMorph(fromStr, toStr, now);
      lastPlaceholderSwitch = now;
    }

    if (placeholderAlpha > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      const baseX = OVERFLOW_X + currentPadX;

      if (placeholderMorph) {
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
        ctx.fillText(PLACEHOLDERS[placeholderIdx], baseX, textY);
      }

      ctx.restore();
    }

    if (text.length > 0) {
      for (let i = 0; i < graphemes.length; i++) {
        const g = graphemes[i];
        let ox = charOffsetX[i] || 0;
        if (ox !== 0) {
          ox += (0 - ox) * 0.26;
          if (Math.abs(ox) < 0.2) ox = 0;
          charOffsetX[i] = ox;
        }

        const charX = textOriginX + positions[i] + ox;
        const anim = charAnims[i];
        let alpha = 1;

        if (anim) {
          const t = Math.min(1, (now - anim.start) / FADE_IN_DURATION);
          alpha = 1 - Math.pow(1 - t, 3);
          if (t >= 1) charAnims[i] = null;
        }

        ctx.save();
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
    updateCharAnimations(performance.now());
    updateScrollAndCaretTarget();
    resetBlink();
  }

  function submitSearch() {
    const query = proxy.value.trim();
    if (!query) return;
    const provider = SEARCH_PROVIDERS[activeProviderIdx] || SEARCH_PROVIDERS[0];
    window.location.href = `${provider.url}${encodeURIComponent(query)}`;
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

  const onSlotEnter = () => {
    if (!isFocused) return;
    openPicker();
  };
  const onSlotLeave = () => scheduleClosePicker(160);
  const onReelEnter = () => clearTimeout(pickerCloseTimer);
  const onReelLeave = () => scheduleClosePicker(160);
  const onSlotClick = (e) => {
    e.stopPropagation();
    const wasFocused = isFocused;
    proxy.focus();
    if (!wasFocused) return;
    if (isPickerOpen) {
      closePicker();
    } else {
      openPicker();
    }
  };
  const onWheelStep = (e) => {
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
          SEARCH_PROVIDERS.length - 1,
          Math.round(targetScrollPos) + Math.sign(e.deltaY),
        ),
      );
      applyReelPosition(true);
    } else {
      // Fine trackpad gesture: accumulate smoothly and snap after idle
      targetScrollPos = Math.max(
        0,
        Math.min(SEARCH_PROVIDERS.length - 1, targetScrollPos + e.deltaY / 72),
      );
      applyReelPosition(true);
      clearTimeout(wheelSnapTimer);
      wheelSnapTimer = setTimeout(() => {
        targetScrollPos = Math.round(targetScrollPos);
        applyReelPosition(true);
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
  };
  const onProxyBlur = () => {
    isFocused = false;
    box.classList.remove("is-focused");
    closePicker();
  };
  const onProxyKeydown = (e) => {
    resetBlink();
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      openPicker();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      stepProvider(dir);
      flashArrow(dir);
      clearTimeout(arrowAutoCloseTimer);
      arrowAutoCloseTimer = setTimeout(() => closePicker(), 1800);
      return;
    }
    if (e.key === "Escape" && isPickerOpen) {
      e.preventDefault();
      closePicker();
      return;
    }
    if (e.key === "Enter" && !isComposing) {
      e.preventDefault();
      if (isPickerOpen) {
        activeProviderIdx = Math.max(
          0,
          Math.min(SEARCH_PROVIDERS.length - 1, Math.round(targetScrollPos)),
        );
        syncProviderIconAndPersist(true);
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

  box.addEventListener("mousedown", onBoxMousedown);
  box.addEventListener("focus", onBoxFocus);
  providerSlot?.addEventListener("mouseenter", onSlotEnter);
  providerSlot?.addEventListener("mouseleave", onSlotLeave);
  providerSlot?.addEventListener("click", onSlotClick);
  providerSlot?.addEventListener("wheel", onWheelStep, { passive: false });
  reelEl?.addEventListener("mouseenter", onReelEnter);
  reelEl?.addEventListener("mouseleave", onReelLeave);
  reelEl?.addEventListener("wheel", onWheelStep, { passive: false });
  proxy.addEventListener("focus", onProxyFocus);
  proxy.addEventListener("blur", onProxyBlur);
  proxy.addEventListener("input", sync);
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

  cleanupSearchFn = () => {
    if (rafId) cancelAnimationFrame(rafId);
    clearTimeout(pickerCloseTimer);
    clearTimeout(arrowAutoCloseTimer);
    clearTimeout(wheelSnapTimer);
    ro.disconnect();
    box.removeEventListener("mousedown", onBoxMousedown);
    box.removeEventListener("focus", onBoxFocus);
    providerSlot?.removeEventListener("mouseenter", onSlotEnter);
    providerSlot?.removeEventListener("mouseleave", onSlotLeave);
    providerSlot?.removeEventListener("click", onSlotClick);
    providerSlot?.removeEventListener("wheel", onWheelStep);
    reelEl?.removeEventListener("mouseenter", onReelEnter);
    reelEl?.removeEventListener("mouseleave", onReelLeave);
    reelEl?.removeEventListener("wheel", onWheelStep);
    proxy.removeEventListener("focus", onProxyFocus);
    proxy.removeEventListener("blur", onProxyBlur);
    proxy.removeEventListener("input", sync);
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
