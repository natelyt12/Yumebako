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
**Yumebako** is a browser extension that replaces your New Tab page, providing a minimalistic yet feature-rich personalized space. With diverse wallpaper sources, useful widgets, and a variety of dynamic visual effects (particles, parallax), Yumebako turns every new tab into an enjoyable experience.

*Note: This project is currently a Work In Progress (WIP) and does not have an official release yet.*

## ✨ Key Features
### 🖼️ Wallpaper Customization
- **Diverse Sources:** Supports wallpapers from Unsplash, Wallhaven, Pic.re (Anime), solid colors, or uploaded from your device (Local Collection).
- **Diverse Sources:** Supports wallpapers from Unsplash, Wallhaven, Pic.re (Anime), or uploaded from your device (Local Collection).
- **Auto Rotation:** Option to rotate wallpapers on a set interval (15m, 30m, 1h...) or every time a new tab is opened.
- **Filters & Colors:** Adjust brightness, contrast, saturation, and bloom effects.

### 💫 Dynamic Effects & Animations
- **Wavy Animation & Parallax:** The wallpaper sways and moves along with your cursor, creating a 3D depth effect.
- **Particle System:** Add realistic dynamic effects such as Rain, Snow, Fireflies, Falling Petals, Dust, and Technology Nodes.
- **Static Effects:** Cinematic frame, TV Noise, and Vignette.
- **Startup Animations:** Choose how the page appears when opened (Cinematic, Gentle, Sleepy, Nature, etc.).

### 🧩 Screen Widgets 🚧 *(Work In Progress)*
> [!WARNING]
> The Widget system is currently under heavy development and may be subject to major changes or instability.
- **Edit Mode:** Freely drag, drop, and easily anchor widgets to specific screen corners/edges.
- **Time & Date:** Large clock (12h/24h formats), current date. Supports changing fonts directly from Google Fonts.
- **Lunar Calendar:** Built-in lunar calendar display.
- **Weather:** Real-time weather information (temperature, humidity, wind speed, feels-like) based on your chosen city.

### ⚙️ Other Features
- **Multi-language:** Supports both English and Vietnamese.
- **Presentation Mode:** Temporarily hides the UI (settings toggle, tab title) when you need to share your screen.
- **Backup & Restore:** Export and import your entire configuration, wallpapers, and system settings via JSON files.

## 🚀 Installation Guide
Since the project is currently in development, you can install it manually via Developer Mode:
1. Clone this repository to your machine:
   ```bash
   git clone https://github.com/natelyt12/Yumebako.git
   ```
2. Install dependencies and build the project:
   ```bash
   npm install
   npm run build
   ```
3. Open your browser (Chrome/Edge/Brave) and navigate to the Extensions management page (`chrome://extensions` or `edge://extensions`).
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the newly generated `dist` folder in the project directory.

## 🛠️ Tech Stack
- **Core:** Vanilla JavaScript, HTML5, CSS3.
- **Build Tool:** Vite, CRXJS Vite Plugin.
- **Libraries:** Day.js (time formatting), Lucide (Icons).

## 🙏 Data Sources & Credits
- Weather Data: [Open-Meteo API](https://open-meteo.com/)
- Weather Icons: [Meteocons](https://github.com/basmilius/weather-icons)
- Wallpaper Sources: [Unsplash](https://unsplash.com/), [Wallhaven](https://wallhaven.cc/), [Pic.re](https://pic.re/)
- Lunar Calendar Algorithm: [Lunar Calendar API](https://github.com/hnthap/lunar-calendar-api) by Huynh Nhan Thap

## 📄 License
This project is distributed under the **GNU AGPL v3** license. See the `LICENSE` file for more details.
