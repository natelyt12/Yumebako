/**
 * Central UI Barrel Export
 * Re-exports all modular UI components for backward compatibility.
 */
export { initToggleSettingBtn, openSidebarSubmenu, closeSidebarSubmenu, attemptCloseSubmenu, setSubmenuDirty } from "./ui/submenu.js";
export { initButtons, createButton } from "./ui/button.js";
export { initSubToggle, setDropdownValue, syncDropdownSelection, toggleDropdown, openDropdown, closeDropdown, closeAllDropdowns, initCustomSelects, upgradeSelectToDropdown } from "./ui/dropdown.js";
export { showConfirm, showAlert, confirmReset } from "./ui/dialog.js";
export { showNotification } from "./ui/notification.js";
export { createSlider } from "./ui/slider.js";

