import "./style.css";
import editorTemplateHtml from "./template.html?raw";
import {
  setSubmenuDirty,
  showNotification,
  createSlider,
  createButton,
  initButtons,
  confirmReset,
  showConfirm,
  Drawer,
} from "/src/core/ui.js";
import { t, translateDOM } from "/src/core/i18n.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { Icons, renderIcons } from "/src/core/icon.js";
import {
  DYNAMIC_EFFECTS,
  STATIC_EFFECTS,
  ALL_EFFECTS,
  EffectsEngine,
  getEffectsEngine,
} from "../../../../backend/effects/particles/index.js";

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ==========================================
// EFFECTS EDITOR UI — 2-block stacked, Submenu-based
// ==========================================
export class EffectsEditorUI {
  constructor(engine) {
    this.engine = engine;
    this._dirty = false;
    this.workingState = null;
    this.columnLists = {};
    this.saveBtn = null;
    this.savedSnapshot = null;
    this.drawer = null;
    this.activeEffectId = null;

    // Every `isDirty = true` assignment refreshes the Save button, so it stays
    // disabled while the working state still matches the last save.
    Object.defineProperty(this, "isDirty", {
      get: () => this._dirty,
      set: (value) => {
        this._dirty = value;
        if (this.saveBtn) this._refreshSaveState();
      },
    });
  }

  _refreshSaveState() {
    if (!this.saveBtn || !this.workingState) return;
    const equal = JSON.stringify(this.workingState) === this.savedSnapshot;
    this.saveBtn.disabled = equal;
    this._dirty = !equal;
    setSubmenuDirty(!equal);
  }

  createPanel() {
    const template = document.createElement("template");
    template.innerHTML = editorTemplateHtml;

    const saved = getSettings().particles || {
      enabled: true,
      dynamicEnabled: false,
      staticEnabled: false,
      dynamic: [],
      static: [],
    };
    this.workingState = JSON.parse(
      JSON.stringify({
        dynamic: saved.dynamic || [],
        static: saved.static || [],
        dynamicEnabled: saved.dynamicEnabled === true,
        staticEnabled: saved.staticEnabled === true,
      }),
    );
    this.savedSnapshot = JSON.stringify(this.workingState);
    this.isDirty = false;
    this.columnLists = {};
    this.columns = {};

    this.clone = template.content.cloneNode(true);
    translateDOM(this.clone);

    const columnsContainer = this.clone.querySelector("#particles_columns");
    if (columnsContainer) {
      columnsContainer.innerHTML = "";
      columnsContainer.appendChild(
        this._buildSection("dynamic", "particles.wallpaper_layer"),
      );
      columnsContainer.appendChild(
        this._buildSection("static", "particles.screen_layer"),
      );
    }

    const btnClearAll = this.clone.querySelector("#btn_clear_all");
    if (btnClearAll) {
      btnClearAll.addEventListener("click", async () => {
        if (!(await confirmReset())) return;
        this._handleReset();
      });
    }

    const btnSave = this.clone.querySelector("#btn_save");
    if (btnSave) {
      this.saveBtn = btnSave;
      btnSave.disabled = true;
      btnSave.addEventListener("click", () => this._handleSave());
    }

    const panelEl = this.clone.firstElementChild;

    // Pre-mount the drawer off-screen so the initial slide-in animation is never skipped
    requestAnimationFrame(() => {
      const host =
        panelEl?.closest?.(".wallpaper_switcher_inner") ||
        document.querySelector(".wallpaper_switcher_inner");
      if (host) {
        this._getDrawer(host);
      }
    });

    return {
      el: panelEl,
      isDirty: () => this.isDirty,
      revert: () => {
        this.drawer?.close();
        if (!this.isDirty) return;
        const savedData = getSettings().particles || {
          enabled: true,
          dynamicEnabled: false,
          staticEnabled: false,
          dynamic: [],
          static: [],
        };
        this.engine.loadState(savedData);
        this.workingState = JSON.parse(
          JSON.stringify({
            dynamic: savedData.dynamic || [],
            static: savedData.static || [],
            dynamicEnabled: savedData.dynamicEnabled === true,
            staticEnabled: savedData.staticEnabled === true,
          }),
        );
        this.isDirty = false;
        setSubmenuDirty(false);
      },
    };
  }

  // ── UI Building ──────────────────────────────

  _buildSection(layer, i18nKey) {
    const col = document.createElement("div");
    col.className = "effects_column";
    this.columns[layer] = col;

    const title = document.createElement("p");
    title.className = "effects_column_title";
    title.setAttribute("data-i18n", i18nKey);
    title.textContent = t(i18nKey);

    const masterToggleLabel = document.createElement("label");
    masterToggleLabel.className = "btn effects_master_toggle";
    masterToggleLabel.setAttribute("data-action", "toggle");

    const toggleBody = document.createElement("div");
    toggleBody.className = "btn_body";

    const toggleTitle = document.createElement("span");
    toggleTitle.className = "btn_title";
    toggleTitle.dataset.i18n =
      layer === "dynamic"
        ? "particles.toggle_dynamic"
        : "particles.toggle_static";
    toggleTitle.textContent =
      layer === "dynamic"
        ? t("particles.toggle_dynamic")
        : t("particles.toggle_static");

    const toggleDesc = document.createElement("span");
    toggleDesc.className = "btn_desc";
    toggleDesc.dataset.i18n =
      layer === "dynamic"
        ? "particles.toggle_dynamic_subtitle"
        : "particles.toggle_static_subtitle";
    toggleDesc.textContent =
      layer === "dynamic"
        ? t("particles.toggle_dynamic_subtitle")
        : t("particles.toggle_static_subtitle");

    toggleBody.append(toggleTitle, toggleDesc);

    const masterToggleInput = document.createElement("input");
    masterToggleInput.type = "checkbox";
    masterToggleInput.className = "master_toggle_input";
    masterToggleInput.checked = this.workingState[`${layer}Enabled`] !== false;

    masterToggleLabel.append(toggleBody, masterToggleInput);
    initButtons(masterToggleLabel);

    const list = document.createElement("div");
    list.className = "effects_list";
    this.columnLists[layer] = list;

    const addArea = this._buildAddArea(layer, list);

    masterToggleInput.onchange = () => {
      const isEnabled = masterToggleInput.checked;
      this.workingState[`${layer}Enabled`] = isEnabled;
      this.isDirty = true;
      setSubmenuDirty(true);

      if (isEnabled) {
        list.style.opacity = "1";
        list.style.pointerEvents = "auto";
        addArea.style.opacity = "1";
        addArea.style.pointerEvents = "auto";
        (this.workingState[layer] || []).forEach((effect) => {
          if (effect.enabled !== false) {
            this.engine.addEffect(
              effect.id,
              layer,
              effect.type,
              effect.config,
            );
          }
        });
      } else {
        list.style.opacity = "0.5";
        list.style.pointerEvents = "none";
        addArea.style.opacity = "0.5";
        addArea.style.pointerEvents = "none";
        (this.workingState[layer] || []).forEach((effect) => {
          this.engine.removeEffect(effect.id, layer);
        });
        if (this.drawer?.isOpen) {
          this.drawer.close();
        }
      }
    };

    if (this.workingState[`${layer}Enabled`] === false) {
      list.style.opacity = "0.5";
      list.style.pointerEvents = "none";
      addArea.style.opacity = "0.5";
      addArea.style.pointerEvents = "none";
    }

    col.append(title, masterToggleLabel, addArea, list);
    this._refreshList(layer);

    return col;
  }

  _buildAddArea(layer, list) {
    const area = document.createElement("div");
    area.className = "dropdown_wrapper";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.setAttribute("data-action", "dropdown");
    btn.id = `add_particle_${layer}`;

    const iconI = document.createElement("i");
    iconI.setAttribute("data-icon", "plus");

    const textSpan = document.createElement("span");
    textSpan.className = "selected_value";
    textSpan.setAttribute("data-i18n", "particles.add_effect");
    textSpan.textContent = t("particles.add_effect") || "Thêm hiệu ứng";

    btn.append(iconI, textSpan);
    initButtons(btn);
    renderIcons(btn);

    const dropdown = document.createElement("div");
    dropdown.className = "dropdown";
    const inner = document.createElement("div");
    inner.className = "dropdown_inner";

    const registry = layer === "static" ? STATIC_EFFECTS : DYNAMIC_EFFECTS;
    for (const [type] of Object.entries(registry)) {
      const item = document.createElement("div");
      item.className = "dropdown_item";
      const i18nKey = `particles.${type}.label`;
      item.setAttribute("data-i18n", i18nKey);
      item.textContent = t(i18nKey) || type;
      item._action = () => {
        this._addEffect(layer, type, list);
      };
      item.onclick = () => {
        if (!item._handled) {
          this._addEffect(layer, type, list);
        }
      };
      inner.appendChild(item);
    }
    dropdown.appendChild(inner);

    area.append(btn, dropdown);
    return area;
  }

  /**
   * Lazily initializes or resolves the Drawer instance.
   * @param {HTMLElement} [anchorElement]
   * @returns {Drawer}
   * @private
   */
  _getDrawer(anchorElement) {
    const host =
      anchorElement?.closest?.(".wallpaper_switcher_inner") ||
      document.querySelector(".wallpaper_switcher_inner") ||
      document.body;

    if (!this.drawer) {
      this.drawer = new Drawer({
        container: host,
        title: "",
        width: "720px",
        placement: "right",
        onClose: () => {
          this.activeEffectId = null;
          this.clone
            ?.querySelectorAll?.(".effect_btn_edit.active")
            ?.forEach((b) => b.classList.remove("active"));
        },
      });
    } else if (this.drawer.container !== host && host) {
      this.drawer.container = host;
      host.appendChild(this.drawer.overlayEl);
      host.appendChild(this.drawer.drawerEl);
    }

    return this.drawer;
  }

  /**
   * Opens the reusable Drawer with a 2-column grid layout for tweaking effect parameters.
   * @param {Object} effectData
   * @param {"dynamic"|"static"} layer
   * @param {HTMLElement} triggerBtn
   * @private
   */
  _openEffectDrawer(effectData, layer, triggerBtn) {
    const drawer = this._getDrawer(triggerBtn);

    // If currently open for the exact same effect, toggle close
    if (drawer.isOpen && this.activeEffectId === effectData.id) {
      drawer.close();
      return;
    }

    this.activeEffectId = effectData.id;
    drawer.triggerBtn = triggerBtn;

    // Refresh active state on buttons
    document
      .querySelectorAll(".effect_btn_edit.active")
      .forEach((b) => b.classList.remove("active"));
    triggerBtn?.classList.add("active");

    // Title: e.g. "Tùy chỉnh hiệu ứng — Bụi lơ lửng"
    const effectName =
      t(`particles.${effectData.type}.label`) || effectData.type;
    const title = `${t("particles.effect_settings", "Tùy chỉnh hiệu ứng")} — ${effectName}`;
    drawer.setTitle(title);

    // Dynamic width: 720px with 2-column grid
    drawer.setWidth("720px");

    const grid = document.createElement("div");
    grid.className = "ui_drawer_grid_2col";

    const EffectClass = ALL_EFFECTS[effectData.type];
    const specs = EffectClass?.getSettingsSpec() || [];
    const sliders = {};

    specs.forEach((spec) => {
      const isColor = spec.type === "color";
      const isToggle = spec.type === "toggle";
      const itemWrapper = document.createElement("div");
      itemWrapper.className = "flex_col gap_4 w_full";

      if (isToggle) {
        const toggle = createButton({
          title: spec.label,
          dataI18n: spec.dataI18n,
          desc: spec.desc,
          action: "toggle",
          checked: Boolean(
            effectData.config[spec.key] ?? spec.defaultValue ?? false,
          ),
        });
        const input = toggle.querySelector('input[type="checkbox"]');
        input.addEventListener("change", () => {
          const val = input.checked;
          effectData.config[spec.key] = val;
          this.engine.updateEffectConfig(effectData.id, layer, {
            [spec.key]: val,
          });
          this.isDirty = true;
          setSubmenuDirty(true);
        });
        itemWrapper.appendChild(toggle);
        // Reset-to-defaults writes through `.value`, like sliders and colors.
        sliders[spec.key] = {
          get value() {
            return input.checked;
          },
          set value(next) {
            input.checked = Boolean(next);
          },
        };
      } else if (isColor) {
        const picker = createButton({
          icon: "colorPicker",
          title: spec.label,
          dataI18n: spec.dataI18n,
          action: "color",
          value: effectData.config[spec.key] ?? EffectClass.DEFAULTS?.[spec.key],
          onChange: (val) => {
            effectData.config[spec.key] = val;
            this.engine.updateEffectConfig(effectData.id, layer, {
              [spec.key]: val,
            });
            this.isDirty = true;
            setSubmenuDirty(true);
          },
        });
        renderIcons(picker);
        itemWrapper.appendChild(picker);
        sliders[spec.key] = picker;
      } else {
        const initialVal = effectData.config[spec.key] ?? spec.defaultValue;
        const sliderComponent = createSlider({
          label: spec.label,
          dataI18n: spec.dataI18n,
          dataI18nUnit: spec.dataI18nUnit,
          min: spec.min,
          max: spec.max,
          step: spec.step,
          value: initialVal,
          defaultValue: spec.defaultValue ?? EffectClass.DEFAULTS?.[spec.key],
          unit: spec.unit,
          onChange: (val) => {
            effectData.config[spec.key] = val;
            this.engine.updateEffectConfig(effectData.id, layer, {
              [spec.key]: val,
            });
            this.isDirty = true;
            setSubmenuDirty(true);
          },
        });
        itemWrapper.appendChild(sliderComponent);
        sliders[spec.key] = sliderComponent;
      }

      if (spec.tooltipKey || spec.tooltip) {
        const tooltip = document.createElement("span");
        tooltip.className = "tooltip";
        if (spec.tooltipKey) {
          tooltip.dataset.i18n = spec.tooltipKey;
          tooltip.textContent = t(spec.tooltipKey);
        } else {
          tooltip.textContent = spec.tooltip;
        }
        itemWrapper.appendChild(tooltip);
      }

      grid.appendChild(itemWrapper);
    });

    drawer.setBody(grid);

    // Footer actions: Reset to defaults & Close
    const footerRow = document.createElement("div");
    footerRow.style.display = "flex";
    footerRow.style.justifyContent = "space-between";
    footerRow.style.alignItems = "center";
    footerRow.style.gap = "12px";

    const btnResetEffect = document.createElement("button");
    btnResetEffect.type = "button";
    btnResetEffect.className = "btn";
    btnResetEffect.innerHTML = `<span class="btn_title">${t("particles.btn_reset_effect", "Đặt lại mặc định")}</span>`;
    btnResetEffect.onclick = async () => {
      if (!(await confirmReset())) return;
      const defaults = { ...(EffectClass.DEFAULTS || {}) };

      for (const [key, val] of Object.entries(defaults)) {
        if (sliders[key]) {
          sliders[key].value = val;
        }
        effectData.config[key] = val;
      }
      this.engine.updateEffectConfig(effectData.id, layer, defaults);
      this.isDirty = true;
      setSubmenuDirty(true);
      showNotification(t("particles.reset_success"), "success");
    };

    const btnDone = document.createElement("button");
    btnDone.type = "button";
    btnDone.className = "btn";
    btnDone.innerHTML = `<span class="btn_title">${t("common.close", "Đóng")}</span>`;
    btnDone.onclick = () => drawer.close();

    footerRow.append(btnResetEffect, btnDone);
    drawer.setFooter(footerRow);

    drawer.open();
  }

  _buildEffectCard(effectData, layer) {
    const card = document.createElement("div");
    card.className = "btn effect_card";
    if (effectData.enabled === false) {
      card.classList.add("effect_disabled");
    }

    const nameEl = document.createElement("span");
    nameEl.className = "effect_card_name";
    nameEl.textContent =
      t(`particles.${effectData.type}.label`) || effectData.type;

    const controls = document.createElement("div");
    controls.className = "effect_card_controls";

    const makeBtn = (content, handler) => {
      const b = document.createElement("button");
      b.innerHTML = content;
      b.onclick = (e) => {
        e.stopPropagation();
        handler(e);
      };
      return b;
    };

    // Action buttons: Delete, Edit (Pencil), Checkbox Toggle
    const btnDelete = makeBtn(Icons.particleDelete, async () => {
      const confirmed = await showConfirm(
        t("particles.delete_confirm_msg") ||
          "Bạn có chắc chắn muốn xóa hiệu ứng này không?",
        {
          title: t("particles.delete_confirm_title") || "Xóa hiệu ứng",
          okText: t("common.delete") || "Xóa",
          isDanger: true,
          anchor: btnDelete,
        },
      );
      if (!confirmed) return;

      if (this.activeEffectId === effectData.id) {
        this.drawer?.close();
      }

      const arr = this.workingState[layer];
      const idx = arr.findIndex((e) => e.id === effectData.id);
      if (idx >= 0) arr.splice(idx, 1);
      this.engine.removeEffect(effectData.id, layer);
      this._refreshList(layer);
      this.isDirty = true;
      setSubmenuDirty(true);
    });
    btnDelete.className = "effect_btn_delete";
    btnDelete.title = t("common.delete") || "Xóa";

    const btnEdit = makeBtn(Icons.particleEdit, () => {
      this._openEffectDrawer(effectData, layer, btnEdit);
    });
    btnEdit.className = "effect_btn_edit";
    btnEdit.title = t("common.edit") || "Chỉnh sửa";

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "effect_toggle";
    toggleLabel.title = t("common.toggle") || "Bật/Tắt";

    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = effectData.enabled !== false;

    const track = document.createElement("div");
    track.className = "ts-track";
    const thumb = document.createElement("div");
    thumb.className = "ts-thumb";
    track.appendChild(thumb);
    toggleLabel.append(toggleInput, track);

    toggleInput.onchange = (e) => {
      e.stopPropagation();
      const newState = toggleInput.checked;
      effectData.enabled = newState;
      this.isDirty = true;
      setSubmenuDirty(true);

      if (newState) {
        this.engine.addEffect(
          effectData.id,
          layer,
          effectData.type,
          effectData.config,
        );
        const arr = this.workingState[layer];
        this.engine.reorderLayers(
          layer,
          arr.map((w) => w.id),
        );
        card.classList.remove("effect_disabled");
      } else {
        this.engine.removeEffect(effectData.id, layer);
        card.classList.add("effect_disabled");
        if (this.activeEffectId === effectData.id) {
          this.drawer?.close();
        }
      }
    };

    // Clicking anywhere on the card opens the effect drawer
    card.addEventListener("click", (e) => {
      if (e.target.closest("button, label, input")) return;
      this._openEffectDrawer(effectData, layer, btnEdit);
    });

    controls.append(btnDelete, btnEdit, toggleLabel);
    card.append(nameEl, controls);

    return card;
  }

  // ── Actions ──────────────────────────────────

  _addEffect(layer, type, list) {
    const arr = this.workingState[layer];
    if (arr.length >= EffectsEngine.MAX_PER_LAYER) {
      showNotification(t("particles.max_effects_reached"), "warning");
      return;
    }
    if (arr.some((e) => e.type === type)) {
      showNotification(
        t("particles.effect_already_exists") || "Hiệu ứng này đã được thêm rồi",
        "warning",
      );
      return;
    }
    const id = genId();
    const EffectClass = ALL_EFFECTS[type];
    const config = { ...(EffectClass.DEFAULTS || {}) };
    const effectData = { id, type, config };

    arr.push(effectData);
    this.engine.addEffect(id, layer, type, config);
    this._refreshList(layer);
    this.isDirty = true;
    setSubmenuDirty(true);
  }

  _refreshList(layer) {
    const list = this.columnLists[layer];
    if (!list) return;
    list.innerHTML = "";
    const effects = this.workingState[layer] || [];

    if (effects.length === 0) {
      const placeholder = document.createElement("div");
      placeholder.className = "effects_placeholder";
      placeholder.setAttribute("data-i18n", "particles.no_effects");
      placeholder.textContent = t("particles.no_effects");
      list.appendChild(placeholder);
    } else {
      effects.forEach((e) => list.appendChild(this._buildEffectCard(e, layer)));
    }
  }

  _handleReset() {
    this.drawer?.close();
    this.engine.stopAll();
    this.workingState.dynamic = [];
    this.workingState.static = [];
    this._refreshList("dynamic");
    this._refreshList("static");
    this.isDirty = true;
    showNotification(t("particles.clear_all_success"), "success");
  }

  _handleSave() {
    this.drawer?.close();
    const current = getSettings().particles || { enabled: true };
    current.dynamic = this.workingState.dynamic;
    current.static = this.workingState.static;
    current.dynamicEnabled = this.workingState.dynamicEnabled;
    current.staticEnabled = this.workingState.staticEnabled;
    current.enabled = true;
    saveSettings({ particles: current });
    this.engine.loadState(current);
    this.savedSnapshot = JSON.stringify(this.workingState);

    showNotification(t("common.saved_changes"), "success");
    this.isDirty = false;
    setSubmenuDirty(false);
  }
}

export function createParticlesPanel() {
  return new EffectsEditorUI(getEffectsEngine()).createPanel();
}
