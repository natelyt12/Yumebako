/**
 * SourceTabs.js
 * ---------------------------------------------------------------------------
 * Tab bar letting the user pick which Switcher source feeds the carousel
 * (Collection | Wallhaven | Unsplash | Picre...). Text only.
 *
 * Purely presentational: it owns the tab DOM, the active highlight and the
 * click intent, then reports the picked source id through `onChange`. Loading
 * data stays the orchestrator's job.
 */
export class SourceTabs {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.container - Element the tabs are rendered into.
     * @param {Array<import("../sources/BaseSource.js").BaseSource>} options.sources
     * @param {string} [options.activeId] - Initially highlighted source id.
     * @param {(id: string) => void} [options.onChange] - Fired on user selection.
     */
    constructor({ container, sources, activeId, onChange }) {
        this.container = container;
        this.sources = sources;
        this.activeId = activeId || sources[0]?.id || null;
        this.onChange = onChange;
        /** @type {Map<string, HTMLButtonElement>} */
        this.buttons = new Map();
    }

    /** Build the tab bar DOM. Safe to call again to rebuild it. */
    render() {
        if (!this.container) return this;

        this.container.innerHTML = "";
        this.container.classList.add("wallpaper_source_tabs");
        this.buttons.clear();

        this.sources.forEach((source) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "wallpaper_source_tab";
            button.dataset.source = source.id;

            const label = document.createElement("span");
            label.dataset.i18n = `wallpaper_switcher.source.${source.id}`;
            label.textContent = source.name;
            button.appendChild(label);

            button.addEventListener("click", () => this.select(source.id));

            this.container.appendChild(button);
            this.buttons.set(source.id, button);
        });

        this._syncActiveClass();
        return this;
    }

    /**
     * Report a pick to the owner. The active highlight is *not* set here: the
     * orchestrator drives it once the source actually becomes active, so a
     * request that gets rejected can never leave the wrong tab highlighted.
     */
    select(id) {
        if (id === this.activeId || !this.buttons.has(id)) return;
        this.onChange?.(id);
    }

    /** Highlight `id` without firing `onChange` (used when syncing state). */
    setActive(id) {
        if (!this.buttons.has(id)) return;
        this.activeId = id;
        this._syncActiveClass();
    }

    /** Cycle to the neighbouring source, wrapping around both ends. */
    step(direction) {
        const ids = this.sources.map((source) => source.id);
        if (ids.length < 2) return;

        const current = ids.indexOf(this.activeId);
        const next = (current + direction + ids.length) % ids.length;
        this.select(ids[next]);
    }

    _syncActiveClass() {
        this.buttons.forEach((button, id) => button.classList.toggle("active", id === this.activeId));
    }
}
