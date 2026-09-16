import { renderIcons } from "/src/core/icon.js";
import { t } from "/src/core/i18n.js";
import { isMoreCard } from "../stores/cardSchema.js";

/**
 * SourceActions.js
 * ---------------------------------------------------------------------------
 * Bottom-centre button row acting on the wallpaper currently centered in the
 * carousel. The buttons come from `source.actions`, so each source decides
 * which verbs it supports (e.g. Collection offers Delete, remote feeds offer
 * Add to collection).
 *
 * An action may also gate itself per card through `isAvailable(card, context)`,
 * which may be asynchronous: resolving `false` drops the button, resolving
 * `{ disabled, reason }` keeps it greyed out. Rendering is therefore async — the
 * previous row stays on screen until the verdicts are in, so a settle never
 * blinks, and a newer render supersedes an older one.
 */
export class SourceActions {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.container
     */
    constructor({ container }) {
        this.container = container;
        /** Render generation, so a slow gate cannot overwrite a newer row. */
        this._token = 0;
    }

    /**
     * Re-render the row for the given source and card.
     * @param {import("../sources/BaseSource.js").BaseSource} source
     * @param {Object|null} card
     * @param {Object} [context] - Extra collaborators handed to the action, e.g. `{ store, switcher }`.
     */
    async render(source, card, context = {}) {
        if (!this.container) return this;

        const token = ++this._token;
        const actions = source?.actions || [];

        if (!card || isMoreCard(card) || actions.length === 0) {
            this._clear();
            return this;
        }

        const verdicts = await Promise.all(actions.map((action) => this._ask(action, card, source, context)));
        if (token !== this._token) return this;

        this._clear();
        actions.forEach((action, index) => {
            if (verdicts[index] === false) return;
            this.container.appendChild(this._createButton(action, card, source, context, verdicts[index]));
        });

        if (this.container.childElementCount === 0) return this;

        this.container.classList.remove("hidden");
        renderIcons(this.container);
        return this;
    }

    /**
     * Ask an action whether it applies to this card.
     * @returns {Promise<boolean|Object>} `false` hides it, `{ disabled }` greys it out.
     */
    async _ask(action, card, source, context) {
        if (!action.isAvailable) return true;

        try {
            return await action.isAvailable(card, { ...context, source });
        } catch (error) {
            // A gate that fails should not take the whole row down with it; the
            // action itself still reports whatever goes wrong when it runs.
            console.error(`[SourceActions] Availability check of [${action.id}] failed:`, error);
            return true;
        }
    }

    /** One button of the row. */
    _createButton(action, card, source, context, verdict) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `icon_button wallpaper_action${action.danger ? " danger_btn" : ""}`;
        button.innerHTML = `<i data-icon="${action.icon}"></i><span></span>`;
        button.querySelector("span").textContent = t(action.labelKey, action.fallback);

        if (verdict?.disabled) {
            button.disabled = true;
            if (verdict.reason) button.title = verdict.reason;
        }

        button.addEventListener("click", (event) => {
            event.stopPropagation();
            Promise.resolve(action.run(card, { ...context, source })).catch((error) =>
                console.error(`[SourceActions] Action [${action.id}] failed:`, error)
            );
        });

        return button;
    }

    /** Empty the row and hide it. */
    _clear() {
        this.container.innerHTML = "";
        this.container.classList.add("hidden");
    }
}
