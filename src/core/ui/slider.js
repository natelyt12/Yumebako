import "./slider.css";
import { Icons } from "/src/core/icon.js";
import { t } from "/src/core/i18n.js";
import { confirmReset } from "./dialog.js";

/**
 * Global configuration values for the Material 3 Expressive Wavy Slider.
 * Tweak these parameters to adjust wave shape, speed, and track layout.
 */
export const SLIDER_CONFIG = {
    // Wave animation speed (px/sec) — lower = slower/gentler, higher = faster
    speed: 6,
    // Distance between wave peaks in pixels — higher = wider & rounder wave, lower = tighter wave
    wavelength: 20,
    // Height of wave peaks from center in pixels — higher = taller waves, lower = flatter waves
    amplitude: 3,
    // SVG sampling step in pixels — smaller = smoother curve (1.0 - 2.0 is optimal)
    stepPx: 1.4,
    // Gap in pixels between thumb and tracks (active wave line & inactive flat line)
    thumbGap: 6,
    // Track horizontal padding in pixels from left & right container edges
    trackPadding: 8,
    // Center Y coordinate of wave & line in pixels (half of track height 36px)
    yCenter: 18,
    // Smooth transition speed towards target value (lerp factor)
    lerpSpeed: 15
};

if (typeof window !== "undefined") {
    window.__SLIDER_CONFIG = SLIDER_CONFIG;
}

// Global wave animation loop to update all visible M3 expressive sliders smoothly
const activeWaveSliders = new Set();
let waveAnimFrame = null;
let wavePhase = 0;
let lastWaveTime = 0;

function waveAnimationLoop(now) {
    if (activeWaveSliders.size === 0) {
        waveAnimFrame = null;
        return;
    }

    if (!lastWaveTime) lastWaveTime = now;
    const dt = Math.min((now - lastWaveTime) / 1000, 0.1);
    lastWaveTime = now;

    // Linear wave slide to the right
    wavePhase = (wavePhase + dt * SLIDER_CONFIG.speed) % 10000;

    for (const slider of activeWaveSliders) {
        if (!slider.isConnected()) {
            activeWaveSliders.delete(slider);
            continue;
        }
        slider.render(wavePhase, dt);
    }

    if (activeWaveSliders.size > 0) {
        waveAnimFrame = requestAnimationFrame(waveAnimationLoop);
    } else {
        waveAnimFrame = null;
    }
}

function registerWaveSlider(slider) {
    activeWaveSliders.add(slider);
    if (!waveAnimFrame) {
        lastWaveTime = performance.now();
        waveAnimFrame = requestAnimationFrame(waveAnimationLoop);
    }
}

/**
 * Creates a reusable premium slider component with a header row (label, number input, reset button)
 * and a full-width Material 3 Expressive range slider below it.
 * 
 * @param {Object} options - Slider configuration
 * @param {string} options.label - The text label of the slider
 * @param {number} options.min - Minimum value
 * @param {number} options.max - Maximum value
 * @param {number} options.step - Increment step
 * @param {number} options.value - Initial value
 * @param {number} options.defaultValue - Default value to reset to
 * @param {string} options.unit - Unit to display next to the number input (e.g. "%", "px", "deg", "s")
 * @param {string} [options.dataI18nUnit] - i18n translation key for the unit
 * @param {function} options.onChange - Callback fired continuously as the value changes (live preview), including every step of a drag.
 * @param {function} [options.onCommit] - Callback fired once when the value is settled: mouse released after a drag, number committed, step button or reset clicked. Use this for persisting.
 * @returns {HTMLElement & { value: number, setValueNoAnim: function(number): void }} The created DOM element wrapper with added properties/methods
 */
export function createSlider(options) {
    const {
        label = "Slider",
        dataI18n = null,
        min = 0,
        max = 100,
        step = 1,
        value = 50,
        defaultValue = 50,
        unit = "",
        dataI18nUnit = null,
        disabled = false,
        onChange = null,
        onCommit = null
    } = options;

    const minVal = Number.isFinite(parseFloat(min)) ? parseFloat(min) : 0;
    const maxVal = Number.isFinite(parseFloat(max)) ? parseFloat(max) : 100;
    const stepVal = Number.isFinite(parseFloat(step)) && parseFloat(step) > 0 ? parseFloat(step) : 1;
    const defaultVal = defaultValue !== undefined && Number.isFinite(parseFloat(defaultValue)) ? parseFloat(defaultValue) : minVal;
    const initialRawVal = value !== undefined && Number.isFinite(parseFloat(value)) ? parseFloat(value) : defaultVal;

    const getDecimals = (n) => {
        const str = String(n);
        if (str.includes("e-")) return parseInt(str.split("e-")[1], 10);
        return (str.split(".")[1] || "").length;
    };
    const decimalPlaces = Math.min(6, Math.max(getDecimals(stepVal), getDecimals(minVal)));

    const roundToStep = (val) => {
        const steps = Math.round((val - minVal) / stepVal);
        let snapped = minVal + steps * stepVal;
        if (snapped < minVal) snapped = minVal;
        if (snapped > maxVal) snapped = maxVal;
        return parseFloat(snapped.toFixed(decimalPlaces));
    };

    const wrapper = document.createElement("div");
    wrapper.className = "custom_slider_group";

    const header = document.createElement("div");
    header.className = "slider_header";

    const labelSpan = document.createElement("span");
    labelSpan.className = "slider_label";
    if (dataI18n) {
        labelSpan.setAttribute("data-i18n", dataI18n);
        labelSpan.innerText = t(dataI18n, label);
    } else {
        labelSpan.innerText = label;
    }

    const controlGroup = document.createElement("div");
    controlGroup.className = "slider_control_group";

    const numInput = document.createElement("input");
    numInput.type = "number";
    numInput.className = "slider_num_input";
    numInput.min = minVal;
    numInput.max = maxVal;
    numInput.step = stepVal;
    numInput.value = roundToStep(initialRawVal);

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "slider_reset_btn";
    resetBtn.innerHTML = Icons.reset;
    resetBtn.title = t("common.reset", "Reset to default");
    resetBtn.setAttribute("data-i18n-title", "common.reset");

    controlGroup.appendChild(numInput);
    const unitSpan = document.createElement("span");
    unitSpan.className = "slider_unit";
    if (dataI18nUnit) {
        unitSpan.setAttribute("data-i18n", dataI18nUnit);
        unitSpan.innerText = t(dataI18nUnit, unit || "\u00A0");
    } else {
        unitSpan.innerText = unit || "\u00A0";
    }
    controlGroup.appendChild(unitSpan);
    controlGroup.appendChild(resetBtn);

    header.appendChild(labelSpan);
    header.appendChild(controlGroup);

    const sliderRow = document.createElement("div");
    sliderRow.className = "slider_row_container";

    const decBtn = document.createElement("button");
    decBtn.type = "button";
    decBtn.className = "slider_step_btn";
    decBtn.innerHTML = Icons.sliderDec;
    decBtn.title = t("common.decrease", "Decrease");
    decBtn.setAttribute("data-i18n-title", "common.decrease");

    const incBtn = document.createElement("button");
    incBtn.type = "button";
    incBtn.className = "slider_step_btn";
    incBtn.innerHTML = Icons.sliderInc;
    incBtn.title = t("common.increase", "Increase");
    incBtn.setAttribute("data-i18n-title", "common.increase");

    const trackContainer = document.createElement("div");
    trackContainer.className = "custom_slider_track_container";

    // SVG elements for smooth wavy line and flat inactive line with rounded caps
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "custom_slider_svg");

    const wavePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    wavePath.setAttribute("class", "custom_slider_wave_path");

    const flatLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    flatLine.setAttribute("class", "custom_slider_flat_line");

    svg.appendChild(wavePath);
    svg.appendChild(flatLine);

    const thumb = document.createElement("div");
    thumb.className = "custom_slider_thumb";

    trackContainer.appendChild(svg);
    trackContainer.appendChild(thumb);

    sliderRow.appendChild(decBtn);
    sliderRow.appendChild(trackContainer);
    sliderRow.appendChild(incBtn);

    wrapper.appendChild(header);
    wrapper.appendChild(sliderRow);

    let currentValue = roundToStep(initialRawVal);
    let isDragging = false;
    let isDisabled = !!disabled;

    let targetPercentage = (currentValue - minVal) / ((maxVal - minVal) || 1);
    let currentPercentage = targetPercentage;

    const setDisabled = (val) => {
        isDisabled = !!val;
        wrapper.classList.toggle("disabled", isDisabled);
        numInput.disabled = isDisabled;
        resetBtn.disabled = isDisabled;
        decBtn.disabled = isDisabled;
        incBtn.disabled = isDisabled;
    };

    function renderTracks(phase, dt) {
        if (!trackContainer.isConnected || trackContainer.offsetParent === null) {
            return;
        }

        const rect = trackContainer.getBoundingClientRect();
        const width = rect.width;
        if (width <= 20) return;

        // Smooth transition towards target if not dragging
        if (!isDragging && Math.abs(currentPercentage - targetPercentage) > 0.0005) {
            const factor = Math.min(1, dt * SLIDER_CONFIG.lerpSpeed);
            currentPercentage += (targetPercentage - currentPercentage) * factor;
        } else if (!isDragging) {
            currentPercentage = targetPercentage;
        }

        const pad = SLIDER_CONFIG.trackPadding;
        const x0 = pad;
        const xEndTotal = width - pad;
        const interactiveWidth = width - pad * 2;
        const thumbX = x0 + currentPercentage * interactiveWidth;

        thumb.style.left = `${thumbX.toFixed(1)}px`;

        const gap = SLIDER_CONFIG.thumbGap;
        const x1 = thumbX - gap;
        const x2 = thumbX + gap;

        // 1. Draw Wavy Active Line with continuous wave and rounded caps
        const L = x1 - x0;
        if (L <= 3) {
            wavePath.setAttribute("d", "");
            wavePath.style.display = "none";
        } else {
            wavePath.style.display = "";
            const wavelength = SLIDER_CONFIG.wavelength;
            const amplitude = SLIDER_CONFIG.amplitude;
            const yCenter = SLIDER_CONFIG.yCenter;
            const stepPx = SLIDER_CONFIG.stepPx;
            const count = Math.ceil(L / stepPx);
            const points = [];

            for (let i = 0; i <= count; i++) {
                const x = Math.min(x0 + i * stepPx, x1);
                const angle = ((x - x0) - phase) * (2 * Math.PI / wavelength);
                const y = yCenter - amplitude * Math.sin(angle);
                points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
            }
            wavePath.setAttribute("d", `M ${points.join(" L ")}`);
        }

        // 2. Draw Inactive Flat Line with rounded caps
        const flatL = xEndTotal - x2;
        if (flatL <= 2) {
            flatLine.style.display = "none";
        } else {
            flatLine.style.display = "";
            flatLine.setAttribute("x1", x2.toFixed(1));
            flatLine.setAttribute("y1", SLIDER_CONFIG.yCenter.toString());
            flatLine.setAttribute("x2", xEndTotal.toFixed(1));
            flatLine.setAttribute("y2", SLIDER_CONFIG.yCenter.toString());
        }
    }

    const sliderState = {
        isConnected: () => trackContainer.isConnected,
        render: renderTracks
    };
    registerWaveSlider(sliderState);

    const resizeObserver = new ResizeObserver(() => {
        renderTracks(wavePhase, 0.016);
    });
    resizeObserver.observe(trackContainer);

    const updateValue = (val, triggerCallback = true, animate = true) => {
        if (isDisabled) return;
        let numericVal = parseFloat(val);
        if (!Number.isFinite(numericVal)) return;

        numericVal = roundToStep(numericVal);

        const isValueChanged = currentValue !== numericVal;

        currentValue = numericVal;
        numInput.value = numericVal;

        targetPercentage = ((numericVal - minVal) / ((maxVal - minVal) || 1));
        if (!animate || isDragging) {
            currentPercentage = targetPercentage;
        }

        renderTracks(wavePhase, 0.016);

        if (triggerCallback && onChange && isValueChanged) {
            onChange(numericVal);
        }
    };

    // Giá trị đã "chốt" (thả tay, gõ số, bấm nút bước, reset) — dùng cho nơi cần
    // ghi xuống storage thay vì bám theo từng bước kéo.
    const commitValue = () => {
        if (isDisabled) return;
        if (onCommit) onCommit(currentValue);
    };

    // Trong lúc kéo chỉ báo `onChange` (xem trước trực tiếp); giá trị "chốt" để
    // lưu xuống storage đi qua `onCommit`, gọi đúng một lần khi thả tay — nếu
    // không, nơi nhận (vd. slider âm lượng lưu settings) sẽ ghi hàng chục lần
    // cho một cú kéo.
    const updateFromMouse = (e) => {
        if (isDisabled) return;
        const rect = trackContainer.getBoundingClientRect();
        const pad = SLIDER_CONFIG.trackPadding;
        const interactiveWidth = rect.width - pad * 2;
        let x = e.clientX - (rect.left + pad);
        if (x < 0) x = 0;
        if (x > interactiveWidth) x = interactiveWidth;

        const percentage = interactiveWidth > 0 ? x / interactiveWidth : 0;
        const rawValue = minVal + percentage * (maxVal - minVal);

        updateValue(rawValue, true, false);
    };

    trackContainer.addEventListener("mousedown", (e) => {
        if (isDisabled) return;
        isDragging = true;
        const valueAtDragStart = currentValue;
        thumb.classList.add("dragging");
        updateFromMouse(e);

        const onMouseMove = (moveEv) => {
            if (!isDragging || isDisabled) return;
            updateFromMouse(moveEv);
        };

        const onMouseUp = () => {
            const hadDragged = isDragging;
            isDragging = false;
            thumb.classList.remove("dragging");
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);

            // Chốt giá trị đúng một lần khi thả tay (kể cả cú click không kéo,
            // vì mousedown đã nhảy tới vị trí mới).
            if (hadDragged && currentValue !== valueAtDragStart) {
                commitValue();
            }
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    });

    const commitInputVal = () => {
        if (isDisabled) return;
        let rawVal = numInput.value.trim();
        if (rawVal === "" || !Number.isFinite(parseFloat(rawVal))) {
            numInput.value = currentValue;
            return;
        }
        updateValue(rawVal, true, true);
        commitValue();
    };

    numInput.addEventListener("blur", commitInputVal);

    numInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            numInput.blur();
        }
    });

    resetBtn.addEventListener("click", async (e) => {
        if (isDisabled) return;
        e.preventDefault();
        if (!(await confirmReset())) return;
        updateValue(defaultVal, true, true);
        commitValue();
    });

    decBtn.addEventListener("click", (e) => {
        if (isDisabled) return;
        e.preventDefault();
        updateValue(currentValue - stepVal, true, true);
        commitValue();
    });

    incBtn.addEventListener("click", (e) => {
        if (isDisabled) return;
        e.preventDefault();
        updateValue(currentValue + stepVal, true, true);
        commitValue();
    });

    updateValue(initialRawVal, false, false);
    if (disabled) setDisabled(true);

    Object.defineProperty(wrapper, "value", {
        get: () => currentValue,
        set: (val) => updateValue(val, false, true),
        configurable: true
    });

    Object.defineProperty(wrapper, "disabled", {
        get: () => isDisabled,
        set: (val) => setDisabled(val),
        configurable: true
    });

    wrapper.setDisabled = setDisabled;
    wrapper.setValueNoAnim = (val) => updateValue(val, false, false);

    return wrapper;
}
