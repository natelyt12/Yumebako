import "./dialog.css";
import { renderIcons } from "/src/core/icon.js";
import { t, translateDOM } from "/src/core/i18n.js";
import { initButtons } from "/src/core/ui/button.js";

let currentZIndex = 50;

/**
 * Displays a centered confirmation dialog with Promise support.
 *
 * @param {string} msg - Message description text.
 * @param {Object} [options={}] - Dialog options.
 * @param {string} [options.title] - Dialog title.
 * @param {string} [options.okText] - Confirm button label.
 * @param {string} [options.cancelText] - Cancel button label.
 * @param {boolean} [options.isDanger=false] - Whether this is a destructive action (styles confirm button with data-variant="danger").
 * @param {string} [options.width="380px"] - Dialog card width.
 * @returns {Promise<boolean>} Resolves to true if confirmed, false otherwise.
 */
export function showConfirm(msg, options = {}) {
    const {
        title = t("common.confirm", "Xác nhận"),
        okText = t("common.confirm", "Đồng ý"),
        cancelText = t("common.cancel", "Hủy"),
        isDanger = false,
        width = "380px"
    } = options;

    return new Promise((resolve) => {
        const root = document.createElement("div");
        root.className = "dialog_root";
        root.style.zIndex = ++currentZIndex;

        const backdrop = document.createElement("div");
        backdrop.className = "dialog_backdrop";

        const container = document.createElement("div");
        container.className = "dialog_container";

        const card = document.createElement("div");
        card.className = "dialog_card";
        card.style.width = width;

        card.innerHTML = `
            <div class="dialog_header">
                <span class="dialog_title">${title}</span>
            </div>
            <div class="dialog_body">
                <p class="dialog_desc">${msg}</p>
            </div>
            <div class="dialog_actions">
                <button id="dialog_cancel_btn" class="btn">${cancelText}</button>
                <button id="dialog_ok_btn" class="btn"${isDanger ? ' data-variant="danger"' : ""}>${okText}</button>
            </div>
        `;

        container.appendChild(card);
        root.append(backdrop, container);
        document.body.appendChild(root);

        let resolved = false;
        const finish = (val) => {
            if (resolved) return;
            resolved = true;
            document.removeEventListener("keydown", onKeyDown);
            root.classList.remove("visible");
            setTimeout(() => {
                root.remove();
            }, 220);
            resolve(val);
        };

        const onKeyDown = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                finish(false);
            } else if (e.key === "Enter") {
                if (document.activeElement !== card.querySelector("#dialog_cancel_btn")) {
                    e.preventDefault();
                    finish(true);
                }
            }
        };

        document.addEventListener("keydown", onKeyDown);

        backdrop.addEventListener("click", () => finish(false));
        container.addEventListener("mousedown", (e) => {
            if (e.target === container) {
                finish(false);
            }
        });

        card.querySelector("#dialog_cancel_btn")?.addEventListener("click", () => finish(false));
        card.querySelector("#dialog_ok_btn")?.addEventListener("click", () => finish(true));

        translateDOM(card);
        initButtons(card);
        renderIcons(card);

        requestAnimationFrame(() => {
            root.classList.add("visible");
            const defaultBtn = isDanger
                ? card.querySelector("#dialog_cancel_btn")
                : card.querySelector("#dialog_ok_btn");
            defaultBtn?.focus();
        });
    });
}

/**
 * Xác nhận trước khi đưa một mục về mặc định. Mọi nút "reset to default" đi qua
 * đây để hành vi xác nhận giống nhau ở toàn app.
 *
 * @param {Object} [options={}] - Ghi đè tiêu đề / nội dung / nhãn nút.
 * @param {string} [options.msg] - Nội dung riêng cho từng mục.
 * @returns {Promise<boolean>} `true` nếu người dùng đồng ý đặt lại.
 */
export function confirmReset(options = {}) {
    const { msg, ...rest } = options;

    return showConfirm(
        msg || t("common.reset_confirm_msg", "Các thay đổi chưa lưu sẽ trở về giá trị mặc định. Tiếp tục?"),
        {
            title: t("common.reset_confirm_title", "Đặt lại về mặc định"),
            okText: t("common.reset", "Đặt lại"),
            cancelText: t("common.cancel", "Hủy"),
            ...rest,
        }
    );
}

/**
 * Displays a centered alert dialog with a single Close button.
 *
 * @param {string} msg - Message description text.
 * @param {Object} [options={}] - Dialog options.
 * @param {string} [options.title] - Dialog title.
 * @param {string} [options.okText] - Button label.
 * @param {string} [options.width="380px"] - Dialog card width.
 * @returns {Promise<void>}
 */
export function showAlert(msg, options = {}) {
    const {
        title = t("common.notice", "Thông báo"),
        okText = t("common.close", "Đóng"),
        width = "380px"
    } = options;

    return new Promise((resolve) => {
        const root = document.createElement("div");
        root.className = "dialog_root";
        root.style.zIndex = ++currentZIndex;

        const backdrop = document.createElement("div");
        backdrop.className = "dialog_backdrop";

        const container = document.createElement("div");
        container.className = "dialog_container";

        const card = document.createElement("div");
        card.className = "dialog_card";
        card.style.width = width;

        card.innerHTML = `
            <div class="dialog_header">
                <span class="dialog_title">${title}</span>
            </div>
            <div class="dialog_body">
                <p class="dialog_desc">${msg}</p>
            </div>
            <div class="dialog_actions">
                <button id="dialog_ok_btn" class="btn">${okText}</button>
            </div>
        `;

        container.appendChild(card);
        root.append(backdrop, container);
        document.body.appendChild(root);

        let resolved = false;
        const finish = () => {
            if (resolved) return;
            resolved = true;
            document.removeEventListener("keydown", onKeyDown);
            root.classList.remove("visible");
            setTimeout(() => {
                root.remove();
            }, 220);
            resolve();
        };

        const onKeyDown = (e) => {
            if (e.key === "Escape" || e.key === "Enter") {
                e.preventDefault();
                finish();
            }
        };

        document.addEventListener("keydown", onKeyDown);

        backdrop.addEventListener("click", finish);
        container.addEventListener("mousedown", (e) => {
            if (e.target === container) {
                finish();
            }
        });

        card.querySelector("#dialog_ok_btn")?.addEventListener("click", finish);

        translateDOM(card);
        initButtons(card);
        renderIcons(card);

        requestAnimationFrame(() => {
            root.classList.add("visible");
            card.querySelector("#dialog_ok_btn")?.focus();
        });
    });
}
