import "./slider.css";
import { Icons } from "/src/core/icon.js";
import { t } from "/src/core/i18n.js";
import { confirmReset } from "./dialog.js";

/**
 * Creates a reusable slider control: a header row (label, number input, unit,
 * reset) and a native range track flanked by optional step buttons.
 *
 * The range is a real `<input type="range">`, so dragging, clicking the track
 * and keyboard stepping come from the browser. The only custom paint is the
 * progress fill, driven by the `--slider-progress` custom property — no
 * animation loop and no SVG path generation.
 *
 * @param {Object} options - Slider configuration
 * @param {string} options.label - The text label of the slider
 * @param {number} options.min - Minimum value
 * @param {number} options.max - Maximum value
 * @param {number} options.step - Increment step
 * @param {number} [options.value] - Initial value (defaults to `min`)
 * @param {number} [options.defaultValue] - Value the reset button restores
 *   (defaults to the initial value, so reset never lands on an arbitrary
 *   number that the track then clamps to its max)
 * @param {string} options.unit - Unit to display next to the number input (e.g. "%", "px", "deg", "s", "x")
 * @param {string} [options.dataI18n] - i18n translation key for the label
 * @param {string} [options.dataI18nUnit] - i18n translation key for the unit
 * @param {boolean} [options.disabled] - Initial disabled state
 * @param {function} options.onChange - Fired continuously while the value moves (live preview)
 * @param {function} [options.onCommit] - Fired once when the value is settled (drag released, number committed, stepped, reset)
 * @returns {HTMLElement & { value: number, disabled: boolean, setDisabled: function(boolean): void, setValueNoAnim: function(number): void }}
 */
export function createSlider({
  label = "Slider",
  dataI18n = null,
  min = 0,
  max = 100,
  step = 1,
  value = undefined,
  defaultValue = undefined,
  unit = "",
  dataI18nUnit = null,
  disabled = false,
  onChange = null,
  onCommit = null,
} = {}) {
  const minVal = Number.isFinite(parseFloat(min)) ? parseFloat(min) : 0;
  const maxVal = Number.isFinite(parseFloat(max)) ? parseFloat(max) : 100;
  const stepVal =
    Number.isFinite(parseFloat(step)) && parseFloat(step) > 0
      ? parseFloat(step)
      : 1;
  const initialRawVal =
    value !== undefined && Number.isFinite(parseFloat(value))
      ? parseFloat(value)
      : minVal;
  // Without an explicit reset target the slider returns to the value it opened
  // with. The old `50` placeholder clamped to the track's max on narrow ranges
  // (e.g. 0.1…4), which read as "reset jumps to the maximum".
  const defaultVal =
    defaultValue !== undefined && Number.isFinite(parseFloat(defaultValue))
      ? parseFloat(defaultValue)
      : initialRawVal;

  const getDecimals = (n) => {
    const str = String(n);
    if (str.includes("e-")) return parseInt(str.split("e-")[1], 10);
    return (str.split(".")[1] || "").length;
  };
  const decimalPlaces = Math.min(
    6,
    Math.max(getDecimals(stepVal), getDecimals(minVal)),
  );

  const roundToStep = (val) => {
    const steps = Math.round((val - minVal) / stepVal);
    let snapped = minVal + steps * stepVal;
    if (snapped < minVal) snapped = minVal;
    if (snapped > maxVal) snapped = maxVal;
    return parseFloat(snapped.toFixed(decimalPlaces));
  };

  let currentValue = roundToStep(initialRawVal);
  let isDisabled = !!disabled;

  const wrapper = document.createElement("div");
  wrapper.className = "custom_slider_group";

  // ── Header: label · number input · unit · reset ──────────────────────────
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
  numInput.value = currentValue;

  const unitSpan = document.createElement("span");
  unitSpan.className = "slider_unit";
  if (dataI18nUnit) {
    unitSpan.setAttribute("data-i18n", dataI18nUnit);
    unitSpan.innerText = t(dataI18nUnit, unit || "\u00A0");
  } else {
    unitSpan.innerText = unit || "\u00A0";
  }

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "slider_reset_btn";
  resetBtn.innerHTML = Icons.reset;
  resetBtn.title = t("common.reset", "Reset to default");
  resetBtn.setAttribute("data-i18n-title", "common.reset");

  controlGroup.append(numInput, unitSpan, resetBtn);
  header.append(labelSpan, controlGroup);

  // ── Track row: − · range · + ─────────────────────────────────────────────
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

  const range = document.createElement("input");
  range.type = "range";
  range.className = "custom_slider_range";
  range.min = minVal;
  range.max = maxVal;
  range.step = stepVal;
  range.value = currentValue;

  // Rail, fill and a flat pill thumb are drawn here; the native range above
  // them stays transparent and only supplies the interaction.
  const trackContainer = document.createElement("div");
  trackContainer.className = "custom_slider_track_container";

  const rail = document.createElement("div");
  rail.className = "slider_rail";

  const fill = document.createElement("div");
  fill.className = "slider_fill";

  const thumb = document.createElement("div");
  thumb.className = "slider_thumb";

  trackContainer.append(rail, fill, thumb, range);
  sliderRow.append(decBtn, trackContainer, incBtn);
  wrapper.append(header, sliderRow);

  /** Repaint the progress fill and the thumb position. */
  const paint = () => {
    const span = maxVal - minVal || 1;
    const percent = ((currentValue - minVal) / span) * 100;
    trackContainer.style.setProperty("--slider-progress", `${percent}%`);
  };

  const setDisabled = (val) => {
    isDisabled = !!val;
    wrapper.classList.toggle("disabled", isDisabled);
    numInput.disabled = isDisabled;
    resetBtn.disabled = isDisabled;
    decBtn.disabled = isDisabled;
    incBtn.disabled = isDisabled;
    range.disabled = isDisabled;
  };

  const setValue = (
    val,
    { trigger = true, commit = false, force = false } = {},
  ) => {
    // External syncs (`setValueNoAnim`) must land even while disabled, so the
    // control is already correct when it gets enabled again.
    if (isDisabled && !force) return;
    let numericVal = parseFloat(val);
    if (!Number.isFinite(numericVal)) return;

    numericVal = roundToStep(numericVal);
    const changed = numericVal !== currentValue;

    currentValue = numericVal;
    if (range.value !== String(numericVal)) range.value = numericVal;
    numInput.value = numericVal;
    paint();

    if (trigger && changed) onChange?.(numericVal);
    if (commit && changed) onCommit?.(numericVal);
  };

  // Native drag / click / keyboard movement.
  range.addEventListener("input", () => {
    if (isDisabled) return;
    const numericVal = roundToStep(parseFloat(range.value));
    const changed = numericVal !== currentValue;
    currentValue = numericVal;
    numInput.value = numericVal;
    paint();
    if (changed) onChange?.(numericVal);
  });

  // `change` fires once the drag settles (or a keyboard step lands).
  range.addEventListener("change", () => {
    if (isDisabled) return;
    onCommit?.(currentValue);
  });

  const commitInputVal = () => {
    if (isDisabled) return;
    const rawVal = numInput.value.trim();
    if (rawVal === "" || !Number.isFinite(parseFloat(rawVal))) {
      numInput.value = currentValue;
      return;
    }
    setValue(rawVal, { trigger: true, commit: true });
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
    setValue(defaultVal, { trigger: true, commit: true });
  });

  decBtn.addEventListener("click", (e) => {
    if (isDisabled) return;
    e.preventDefault();
    setValue(currentValue - stepVal, { trigger: true, commit: true });
  });

  incBtn.addEventListener("click", (e) => {
    if (isDisabled) return;
    e.preventDefault();
    setValue(currentValue + stepVal, { trigger: true, commit: true });
  });

  paint();
  if (disabled) setDisabled(true);

  Object.defineProperty(wrapper, "value", {
    get: () => currentValue,
    set: (val) => setValue(val, { trigger: false }),
    configurable: true,
  });

  Object.defineProperty(wrapper, "disabled", {
    get: () => isDisabled,
    set: (val) => setDisabled(val),
    configurable: true,
  });

  wrapper.setDisabled = setDisabled;
  wrapper.setValueNoAnim = (val) =>
    setValue(val, { trigger: false, force: true });

  return wrapper;
}
