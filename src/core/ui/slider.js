import { Icons } from "/src/core/icon.js";

/**
 * Creates a reusable premium slider component with a header row (label, number input, reset button)
 * and a full-width range slider below it.
 * 
 * @param {Object} options - Slider configuration
 * @param {string} options.label - The text label of the slider
 * @param {number} options.min - Minimum value
 * @param {number} options.max - Maximum value
 * @param {number} options.step - Increment step
 * @param {number} options.value - Initial value
 * @param {number} options.defaultValue - Default value to reset to
 * @param {string} options.unit - Unit to display next to the number input (e.g. "%", "px", "deg", "s")
 * @param {function} options.onChange - Callback triggered on slider or input changes (receives new float value)
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
        disabled = false,
        onChange = null
    } = options;

    const wrapper = document.createElement("div");
    wrapper.className = "custom_slider_group";

    const header = document.createElement("div");
    header.className = "slider_header";

    const labelSpan = document.createElement("span");
    labelSpan.className = "slider_label";
    labelSpan.innerText = label;
    if (dataI18n) {
        labelSpan.setAttribute("data-i18n", dataI18n);
    }

    const controlGroup = document.createElement("div");
    controlGroup.className = "slider_control_group";

    const numInput = document.createElement("input");
    numInput.type = "number";
    numInput.className = "slider_num_input";
    numInput.min = min;
    numInput.max = max;
    numInput.step = step;
    numInput.value = value;

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "slider_reset_btn";
    resetBtn.innerHTML = Icons.reset;
    resetBtn.title = "Reset to default";

    controlGroup.appendChild(numInput);
    const unitSpan = document.createElement("span");
    unitSpan.className = "slider_unit";
    unitSpan.innerText = unit || "\u00A0";
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

    const incBtn = document.createElement("button");
    incBtn.type = "button";
    incBtn.className = "slider_step_btn";
    incBtn.innerHTML = Icons.sliderInc;

    const trackContainer = document.createElement("div");
    trackContainer.className = "custom_slider_track_container";

    const track = document.createElement("div");
    track.className = "custom_slider_track";

    const trackFill = document.createElement("div");
    trackFill.className = "custom_slider_track_fill";
    track.appendChild(trackFill);

    const thumb = document.createElement("div");
    thumb.className = "custom_slider_thumb";

    trackContainer.appendChild(track);
    trackContainer.appendChild(thumb);

    sliderRow.appendChild(decBtn);
    sliderRow.appendChild(trackContainer);
    sliderRow.appendChild(incBtn);

    wrapper.appendChild(header);
    wrapper.appendChild(sliderRow);

    let currentValue = value;
    let isDragging = false;
    let isDisabled = !!disabled;

    const setDisabled = (val) => {
        isDisabled = !!val;
        wrapper.classList.toggle("disabled", isDisabled);
        numInput.disabled = isDisabled;
        resetBtn.disabled = isDisabled;
        decBtn.disabled = isDisabled;
        incBtn.disabled = isDisabled;
    };

    const updateValue = (val, triggerCallback = true, animate = true) => {
        if (isDisabled) return;
        let numericVal = parseFloat(val);
        if (isNaN(numericVal)) return;

        if (numericVal < min) numericVal = min;
        if (numericVal > max) numericVal = max;

        const decimalPlaces = (step.toString().split('.')[1] || '').length;
        numericVal = parseFloat(numericVal.toFixed(decimalPlaces));

        const isValueChanged = currentValue !== numericVal;

        currentValue = numericVal;
        numInput.value = numericVal;

        const percentage = ((numericVal - min) / (max - min));

        if (animate && !isDragging) {
            thumb.style.transition = "left 0.3s var(--expo_out), transform 0.3s var(--expo_out), border-radius 0.3s var(--expo_out), box-shadow 0.3s var(--expo_out)";
            trackFill.style.transition = "width 0.3s var(--expo_out)";
        } else {
            thumb.style.transition = "transform 0.3s var(--expo_out), border-radius 0.3s var(--expo_out), box-shadow 0.3s var(--expo_out)";
            trackFill.style.transition = "none";
        }

        const posCalc = `calc(8px + ${percentage} * (100% - 16px))`;
        thumb.style.left = posCalc;
        trackFill.style.width = posCalc;

        if (triggerCallback && onChange && isValueChanged) {
            onChange(numericVal);
        }
    };

    const updateFromMouse = (e) => {
        if (isDisabled) return;
        const rect = trackContainer.getBoundingClientRect();
        const interactiveWidth = rect.width - 16;
        let x = e.clientX - (rect.left + 8);
        if (x < 0) x = 0;
        if (x > interactiveWidth) x = interactiveWidth;

        const percentage = x / interactiveWidth;
        const rawValue = min + percentage * (max - min);

        const steps = Math.round((rawValue - min) / step);
        const snappedValue = min + steps * step;

        updateValue(snappedValue, true, false);
    };

    trackContainer.addEventListener("mousedown", (e) => {
        if (isDisabled) return;
        isDragging = true;
        thumb.classList.add("dragging");
        updateFromMouse(e);

        const onMouseMove = (moveEv) => {
            if (!isDragging || isDisabled) return;
            updateFromMouse(moveEv);
        };

        const onMouseUp = () => {
            isDragging = false;
            thumb.classList.remove("dragging");
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    });

    const commitInputVal = () => {
        if (isDisabled) return;
        let rawVal = numInput.value.trim();
        if (rawVal === "" || isNaN(parseFloat(rawVal))) {
            numInput.value = currentValue;
            return;
        }
        updateValue(rawVal, true, true);
    };

    numInput.addEventListener("blur", commitInputVal);

    numInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            numInput.blur();
        }
    });

    resetBtn.addEventListener("click", (e) => {
        if (isDisabled) return;
        e.preventDefault();
        updateValue(defaultValue, true, true);
    });

    decBtn.addEventListener("click", (e) => {
        if (isDisabled) return;
        e.preventDefault();
        updateValue(currentValue - step, true, true);
    });

    incBtn.addEventListener("click", (e) => {
        if (isDisabled) return;
        e.preventDefault();
        updateValue(currentValue + step, true, true);
    });

    updateValue(value, false, false);
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
