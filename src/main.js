import { start } from "./core/launcher.js";

// Prevent tab focus transitions
document.addEventListener("keydown", function (e) {
    if (e.key === "Tab") {
        e.preventDefault();
    }
});

// Launch the application
start();
