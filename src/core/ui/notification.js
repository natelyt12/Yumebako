/**
 * Display a top-center notification with a 5-second progress bar.
 * Supporting multiple concurrent notifications.
 * @param {string} message - The text content to display.
 * @param {"info"|"success"|"error"|"warning"} type - The visual style of the notification.
 */
export function showNotification(message, type = "info") {
    let container = document.querySelector(".notification_container");

    if (!container) {
        container = document.createElement("div");
        container.className = "notification_container";
        document.body.appendChild(container);
    }

    const activeNotifications = container.querySelectorAll(".notification:not(.exit)");
    if (activeNotifications.length >= 5) {
        const oldest = activeNotifications[0];
        oldest.style.maxHeight = oldest.offsetHeight + "px";
        oldest.offsetHeight; // force reflow
        oldest.classList.add("exit");
        setTimeout(() => {
            if (oldest.parentElement) oldest.remove();
        }, 350);
    }

    const notification = document.createElement("div");
    notification.className = `notification ${type}`;

    const text = document.createElement("span");
    text.textContent = message;
    notification.appendChild(text);

    const progress = document.createElement("div");
    progress.className = "notification_progress";
    notification.appendChild(progress);

    container.appendChild(notification);

    const removeNotification = () => {
        if (!notification.parentElement || notification.classList.contains("exit")) return;

        notification.style.maxHeight = notification.offsetHeight + "px";
        notification.offsetHeight; // force reflow
        notification.classList.add("exit");
        setTimeout(() => {
            notification.remove();
            if (container.children.length === 0 && container.parentElement) {
                container.remove();
            }
        }, 350);
    };

    // Pause on hover
    notification.addEventListener("mouseenter", () => {
        progress.style.animationPlayState = "paused";
    });
    
    // Resume on leave
    notification.addEventListener("mouseleave", () => {
        progress.style.animationPlayState = "running";
    });
    
    // Dismiss on click
    notification.addEventListener("click", () => {
        removeNotification();
    });

    // Use animationend instead of setTimeout to automatically sync with CSS animation state
    progress.addEventListener("animationend", removeNotification);
}
