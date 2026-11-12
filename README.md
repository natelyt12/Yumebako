# 🌌 Yumebako

<div align="center">
  <p><i>Your own dreambox - A highly customizable new tab page extension.</i></p>
  <p>
    <img src="https://img.shields.io/badge/Version-1.0.0_(WIP)-blue.svg" alt="Version">
    <img src="https://img.shields.io/badge/License-AGPL%20v3-green.svg" alt="License">
    <img src="https://img.shields.io/badge/Status-In%20Development-orange.svg" alt="Status">
  </p>
</div>

## 📌 About
**Yumebako** is a browser extension that replaces your New Tab page with a wallpaper-first personal space. Roll wallpapers from several curated sources, browse them in a carousel switcher, and give each one its own filters, motion and effect profile — so every new tab feels hand-made instead of generic.

*Note: This project is currently a Work In Progress (WIP) and does not have an official release yet.*

## ✨ Key Features
### 🖼️ Wallpaper Sources
- **Bing:** daily Bing imagery with a configurable resolution.
- **Unsplash:** curated topics, keyword search and orientation filters.
- **Wallhaven:** keyword search with categories, resolution and sorting options.
- **Pic.re:** anime-focused wallpapers.
- **Collection:** your own library — upload images/videos from your device, or save any wallpaper rolled from the sources above into it.

Each source keeps its own capped history of rolled wallpapers, plus a "clear history" action that frees up space.

### 🎠 Wallpaper Switcher <kbd>Alt</kbd> + <kbd>W</kbd>
- **Carousel:** the active source is shown as a horizontal strip — roll a new wallpaper, flick through history, click to apply.
- **Instant preview:** hold <kbd>V</kbd> to preview the highlighted wallpaper fullscreen before applying it.
- **Manage Wallpapers:** a full grid view to browse, apply, download, bulk-select or delete the wallpapers of any source.
- **Keyboard friendly:** <kbd>Alt</kbd> + <kbd>W</kbd> toggles the switcher, <kbd>Esc</kbd> backs out of the current submenu.

### 🎨 Per-wallpaper Customization
- **Filters & Colors:** brightness, contrast, saturation, blur, bloom (images only) and RGB shift (chromatic aberration).
- **Adjust Position:** drag and zoom the framing, or fit the image to the screen.
- **Saved with the wallpaper:** every wallpaper in the Collection keeps its own effect profile, so coming back to it restores exactly what you tuned. Wallpapers rolled from a remote source become editable as soon as they are saved to the Collection.

### 💫 Effects & Animations
- **Wavy + Parallax:** the wallpaper sways and follows your cursor, with tunable amplitude, inertia and scale.
- **Particles:** layer rain, snow, falling petals, autumn leaves, dust or technology nodes — either behind the wallpaper or across the whole screen.
- **Static effects:** cinematic frame and vignette.
- **Startup Animation:** Gentle (default), Instant, Cinematic, Sleepy and Chill presets, plus a fully custom setup (zoom, rotation, speed, blur, easing, overlay fade) with a live preview.

### 📚 Collection Library
- Store images and videos, pull wallpapers in from any other source, and keep each one's customizations attached.
- **Sorting:** by effects (default), by video, by date added (with an "oldest first" toggle), or by source priority — drag the source list to reorder the groups.
- **Bulk actions:** multi-select to apply, download or delete, with a confirmation that lists the customizations that will be lost.

### ⚙️ General
- **Appearance:** custom tab title, a hideable & opacity-adjustable settings toggle, and Presentation Mode (<kbd>Ctrl</kbd> + <kbd>X</kbd>) that hides the UI while you share your screen.
- **Multi-language:** English and Vietnamese.
- **Backup & Restore:** export/import wallpaper settings, system settings or everything at once as JSON files.
- **Danger zone:** one-click reset back to defaults.

## 🚀 Installation Guide
Since the project is currently in development, you can install it manually via Developer Mode:
1. Clone this repository to your machine:
   ```bash
   git clone https://github.com/natelyt12/Yumebako.git
   ```
2. Install dependencies and build the project (pnpm is the package manager used by this repo):
   ```bash
   pnpm install
   pnpm build
   ```
   For development with hot reload, run `pnpm dev` instead of `pnpm build` and keep it running.
3. Open your browser (Chrome/Edge/Brave) and navigate to the Extensions management page (`chrome://extensions` or `edge://extensions`).
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the `dist` folder in the project directory.

Useful scripts:

| Command | Description |
| --- | --- |
| `pnpm dev` | Vite dev server with HMR for the extension |
| `pnpm build` | Production build into `dist/` |
| `pnpm test` | Run the test suites with `node --test` |

## 🛠️ Tech Stack
- **Core:** Vanilla JavaScript, HTML5, CSS3 (native CSS layers, no framework).
- **Build Tool:** Vite, CRXJS Vite Plugin (Manifest V3).
- **Libraries:** Day.js (time formatting), Phosphor Icons.
- **Storage:** LocalStorage for settings (split between wallpaper and system scopes) and IndexedDB for cached wallpaper media.
- **Testing:** `node:test` suites under `tests/`.

## 📂 Project Structure
```text
src/
├── core/        # Settings storage, i18n, event bus, IndexedDB, shared UI primitives
├── wallpaper/   # Wallpaper subsystem: sources, rendering, effects, switcher & customization UI
├── settings/    # Settings panel and system utilities (backup, diagnostics)
├── styles/      # Design tokens, CSS layers and global styles
├── widgets/     # Widget system (still in development)
└── main.js      # App entry point
public/locales/  # en.json / vi.json translations
tests/           # node:test suites
```

## 🙏 Data Sources & Credits
- Weather Data: [Open-Meteo API](https://open-meteo.com/)
- Weather Icons: [Meteocons](https://github.com/basmilius/weather-icons)
- Wallpaper Sources: [Unsplash](https://unsplash.com/), [Wallhaven](https://wallhaven.cc/), [Pic.re](https://pic.re/)
- Lunar Calendar Algorithm: [Lunar Calendar API](https://github.com/hnthap/lunar-calendar-api) by Huynh Nhan Thap

## 📄 License
This project is distributed under the **GNU AGPL v3** license. See the `LICENSE` file for more details.
