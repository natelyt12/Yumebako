import "./effects.css";
import { openSidebarSubmenu, setSubmenuDirty, showNotification, createSlider, initButtons, confirmReset } from "/src/core/ui.js";
import { t, translateDOM } from "/src/core/i18n.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { Icons, renderIcons } from "/src/core/icon.js";
import { DYNAMIC_EFFECTS, STATIC_EFFECTS, ALL_EFFECTS } from "./registry.js";
import { EffectsEngine } from "./EffectsEngine.js";

function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ==========================================
// EFFECTS EDITOR UI — 2-block stacked, Submenu-based
// ==========================================
export class EffectsEditorUI {
    constructor(engine) {
        this.engine = engine;
        this.isDirty = false;
        this.workingState = null;
        this.columnLists = {};
    }

    initialize() {
        const editBtn = document.getElementById("edit_particles_settings");
        if (editBtn) {
            editBtn.addEventListener("click", () => this.openEditor());
        }
    }

    openEditor() {
        const template = document.getElementById("tpl_particles_settings");
        if (!template) return;

        const saved = getSettings().particles || { enabled: true, dynamicEnabled: false, staticEnabled: false, dynamic: [], static: [] };
        this.workingState = JSON.parse(JSON.stringify({
            dynamic: saved.dynamic || [],
            static: saved.static || [],
            dynamicEnabled: saved.dynamicEnabled === true,
            staticEnabled: saved.staticEnabled === true,
        }));
        this.isDirty = false;
        this.columnLists = {};
        this.columns = {};

        this.clone = template.content.cloneNode(true);
        translateDOM(this.clone);

        const columnsContainer = this.clone.querySelector("#particles_columns");
        if (columnsContainer) {
            columnsContainer.innerHTML = "";
            columnsContainer.appendChild(this._buildSection("dynamic", "particles.wallpaper_layer"));
            columnsContainer.appendChild(this._buildSection("static", "particles.screen_layer"));
            const emptyDivider = document.createElement("div");
            emptyDivider.className = "section_divider";
            columnsContainer.appendChild(emptyDivider);
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
            btnSave.addEventListener("click", () => this._handleSave());
        }

        const windowTitle = t("sp.wallpaper_customization.particles_settings");
        openSidebarSubmenu(windowTitle, this.clone, {
            width: "500px",
            canPreview: true,
            isDirty: () => this.isDirty,
            onCancel: () => {
                if (this.isDirty) {
                    const savedData = getSettings().particles || { enabled: true, dynamicEnabled: false, staticEnabled: false, dynamic: [], static: [] };
                    this.engine.loadState(savedData);
                    this.isDirty = false;
                    setSubmenuDirty(false);
                }
            }
        });
    }

    // ── UI Building ──────────────────────────────


    _buildSection(layer, i18nKey) {
        const frag = document.createDocumentFragment();

        const title = document.createElement("p");
        title.className = "setting_title";
        title.setAttribute("data-i18n", i18nKey);
        title.textContent = t(i18nKey);

        const masterToggleLabel = document.createElement("label");
        masterToggleLabel.className = "btn";
        masterToggleLabel.setAttribute("data-action", "toggle");
        masterToggleLabel.style.marginBottom = "8px";
        
        const toggleText = document.createElement("span");
        toggleText.textContent = layer === "dynamic" ? (t("particles.toggle_dynamic") || "Bật/tắt tất cả") : (t("particles.toggle_static") || "Bật/tắt tất cả");
        
        const masterToggleInput = document.createElement("input");
        masterToggleInput.type = "checkbox";
        masterToggleInput.checked = this.workingState[`${layer}Enabled`] !== false;
        
        masterToggleLabel.append(toggleText, masterToggleInput);
        initButtons(masterToggleLabel);

        const list = document.createElement("div");
        list.className = "effects_list";
        this.columnLists[layer] = list;
        

        const addArea = this._buildAddArea(layer, list);
        
        masterToggleInput.onchange = (e) => {
            const newState = e.target.checked;
            this.workingState[`${layer}Enabled`] = newState;
            this.isDirty = true;
            setSubmenuDirty(true);
            if (newState) {
                list.style.opacity = "1";
                list.style.pointerEvents = "auto";
                addArea.style.opacity = "1";
                addArea.style.pointerEvents = "auto";
                (this.workingState[layer] || []).forEach(effect => {
                    if (effect.enabled !== false) {
                        this.engine.addEffect(effect.id, layer, effect.type, effect.config);
                    }
                });
            } else {
                list.style.opacity = "0.5";
                list.style.pointerEvents = "none";
                addArea.style.opacity = "0.5";
                addArea.style.pointerEvents = "none";
                (this.workingState[layer] || []).forEach(effect => {
                    this.engine.removeEffect(effect.id, layer);
                });
            }
        };

        if (this.workingState[`${layer}Enabled`] === false) {
            list.style.opacity = "0.5";
            list.style.pointerEvents = "none";
            addArea.style.opacity = "0.5";
            addArea.style.pointerEvents = "none";
        }

        frag.append(title, masterToggleLabel, addArea, list);
        this._refreshList(layer);

        return frag;
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

    _buildEffectCard(effectData, layer) {
        const card = document.createElement("div");
        card.className = "effect_card";
        if (effectData.enabled === false) {
            card.classList.add("effect_disabled");
        }

        // Header row
        const header = document.createElement("div");
        header.className = "effect_card_header";

        const nameEl = document.createElement("span");
        nameEl.className = "effect_card_name";
        nameEl.textContent = t(`particles.${effectData.type}.label`) || effectData.type;

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

        // Individual effect toggle button
        const btnToggle = makeBtn(effectData.enabled !== false ? Icons.particleCheck : Icons.particleX, (e) => {
            const newState = effectData.enabled === false; // toggle state
            effectData.enabled = newState;
            this.isDirty = true;
            setSubmenuDirty(true);
            
            btnToggle.innerHTML = newState ? Icons.particleCheck : Icons.particleX;
            
            if (newState) {
                this.engine.addEffect(effectData.id, layer, effectData.type, effectData.config);
                const arr = this.workingState[layer];
                this.engine.reorderLayers(layer, arr.map(w => w.id));
                card.classList.remove("effect_disabled");
            } else {
                this.engine.removeEffect(effectData.id, layer);
                card.classList.add("effect_disabled");
            }
        });

        // Inline Drawer for Sliders
        const drawer = document.createElement("div");
        drawer.className = "effect_card_drawer";

        const drawerContent = document.createElement("div");
        drawerContent.className = "effect_card_drawer_content";

        const EffectClass = ALL_EFFECTS[effectData.type];
        const specs = EffectClass?.getSettingsSpec() || [];

        const sliders = {};
        specs.forEach(spec => {
            const initialVal = effectData.config[spec.key] ?? spec.defaultValue;
            const sliderComponent = createSlider({
                label: spec.label,
                dataI18n: spec.dataI18n,
                dataI18nUnit: spec.dataI18nUnit,
                min: spec.min,
                max: spec.max,
                step: spec.step,
                value: initialVal,
                defaultValue: spec.defaultValue ?? (EffectClass.DEFAULTS?.[spec.key]),
                unit: spec.unit,
                onChange: (val) => {
                    effectData.config[spec.key] = val;
                    this.engine.updateEffectConfig(effectData.id, layer, { [spec.key]: val });
                    this.isDirty = true;
                    setSubmenuDirty(true);
                }
            });
            drawerContent.appendChild(sliderComponent);
            sliders[spec.key] = sliderComponent;
        });

        // Action row inside drawer: Reset to Defaults
        const drawerActions = document.createElement("div");
        drawerActions.style.display = "flex";
        drawerActions.style.justifyContent = "flex-end";
        drawerActions.style.marginTop = "4px";

        const btnResetEffect = document.createElement("button");
        btnResetEffect.textContent = t("particles.btn_reset_effect");
        btnResetEffect.onclick = async (e) => {
            e.stopPropagation();
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

        drawerActions.appendChild(btnResetEffect);
        drawerContent.appendChild(drawerActions);
        drawer.appendChild(drawerContent);

        // Gear icon button to toggle drawer expansion
        const btnSettings = makeBtn(Icons.particleSettings, () => {
            const isOpen = drawer.classList.toggle("open");
            if (isOpen) {
                btnSettings.classList.add("active");
            } else {
                btnSettings.classList.remove("active");
            }
        });

        const btnDelete = makeBtn(Icons.particleDelete, () => {
            const arr = this.workingState[layer];
            const idx = arr.findIndex(e => e.id === effectData.id);
            if (idx >= 0) arr.splice(idx, 1);
            this.engine.removeEffect(effectData.id, layer);
            this._refreshList(layer);
            this.isDirty = true;
            setSubmenuDirty(true);
        });

        controls.append(btnSettings, btnToggle, btnDelete);
        header.append(nameEl, controls);
        card.append(header, drawer);

        return card;
    }

    // ── Actions ──────────────────────────────────

    _addEffect(layer, type, list) {
        const arr = this.workingState[layer];
        if (arr.length >= EffectsEngine.MAX_PER_LAYER) {
            showNotification(t("particles.max_effects_reached"), "warning");
            return;
        }
        if (arr.some(e => e.type === type)) {
            showNotification(t("particles.effect_already_exists") || "Hiệu ứng này đã được thêm rồi", "warning");
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
            effects.forEach(e =>
                list.appendChild(this._buildEffectCard(e, layer))
            );
        }
    }

    _handleReset() {
        this.engine.stopAll();
        this.workingState.dynamic = [];
        this.workingState.static = [];
        this._refreshList("dynamic");
        this._refreshList("static");
        this.isDirty = true;
        setSubmenuDirty(true);
        showNotification(t("particles.clear_all_success"), "success");
    }

    _handleSave() {
        const current = getSettings().particles || { enabled: true };
        current.dynamic = this.workingState.dynamic;
        current.static = this.workingState.static;
        current.dynamicEnabled = this.workingState.dynamicEnabled;
        current.staticEnabled = this.workingState.staticEnabled;
        current.enabled = true;
        saveSettings({ particles: current });
        this.engine.loadState(current);

        showNotification(t("common.saved_changes"), "success");
        this.isDirty = false;
        setSubmenuDirty(false);
    }
}
