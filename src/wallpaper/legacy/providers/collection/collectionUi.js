import { t } from "/src/core/i18n.js";
import { showConfirm, openSidebarSubmenu, showNotification } from "/src/core/ui.js";
import { Icons, renderIcons } from "/src/core/icon.js";
import {
    getCollection,
    addToCollection,
    removeFromCollection,
    removeMultipleFromCollection,
} from "/src/wallpaper/sources/api/collectionDb.js";
import { generateImageThumbnail, generateVideoThumbnail, getImageDimensions } from "/src/core/utils/thumbnailGenerator.js";
import { providerManager } from "/src/wallpaper/legacy/ProviderManager.js";

// Map to track active thumbnail blob URLs so they can be revoked on cleanup
const activeThumbnailUrls = new Set();

let isSelectMode = false;
let selectedItemIds = new Set();
let bulkDeleteBtnRef = null;
let uploadBtnRef = null;

function updateBulkDeleteBtn() {
    if (!bulkDeleteBtnRef) return;
    if (isSelectMode) {
        bulkDeleteBtnRef.style.display = "flex";
        bulkDeleteBtnRef.disabled = selectedItemIds.size === 0;
        const span = bulkDeleteBtnRef.querySelector("span");
        if (span) {
            if (selectedItemIds.size > 0) {
                span.textContent = t("sp.api.collection.delete_selected_count", { count: selectedItemIds.size }, `Xóa ${selectedItemIds.size} mục`);
            } else {
                span.textContent = t("sp.api.collection.delete_selected", "Xóa mục đã chọn");
            }
        }
    } else {
        bulkDeleteBtnRef.style.display = "none";
    }
}

function updateSelectionIndices() {
    const arr = Array.from(selectedItemIds);
    const grid = document.querySelector("#coll_grid");
    if (!grid) return;
    const cards = grid.querySelectorAll(".bg_coll_card");
    cards.forEach(card => {
        const idx = arr.indexOf(card.dataset.id);
        const thumbWrapper = card.querySelector(".bg_coll_thumb_wrapper");
        if (thumbWrapper) {
            if (idx !== -1) {
                thumbWrapper.setAttribute("data-index", idx + 1);
            } else {
                thumbWrapper.removeAttribute("data-index");
            }
        }
    });
}

export async function openCollectionPopup() {
    const wrapper = await createCollectionSettingsUI();
    if (!wrapper) return;
    
    openSidebarSubmenu(t("sp.api.collection.collection_title", "Bộ sưu tập hình nền"), wrapper, {
        width: "800px",
        onBeforeClose: () => {
            cleanupCollectionUI();
        }
    });
}

export async function createCollectionSettingsUI() {
    const tpl = document.getElementById("bg_collection_popup_tpl");
    if (!tpl) {
        console.error("[Collection] Template #bg_collection_popup_tpl not found");
        return null;
    }

    const content = tpl.content.cloneNode(true);
    const wrapper = document.createElement("div");
    wrapper.appendChild(content);

    renderIcons(wrapper);

    const uploadBtn = wrapper.querySelector("#coll_upload_btn");
    uploadBtnRef = uploadBtn;
    const fileInput = wrapper.querySelector("#coll_file_input");
    const grid = wrapper.querySelector("#coll_grid");
    const emptyState = wrapper.querySelector("#coll_empty_state");

    const uploadSpan = wrapper.querySelector("#coll_upload_btn span");
    if (uploadSpan) uploadSpan.textContent = t("sp.api.collection.upload_btn", "Tải lên ảnh / video");

    const emptyTitle = wrapper.querySelector("#coll_empty_state p");
    if (emptyTitle) emptyTitle.textContent = t("sp.api.collection.empty_title", "Bộ sưu tập trống");

    const emptyDesc = wrapper.querySelector("#coll_empty_state span");
    if (emptyDesc) emptyDesc.textContent = t("sp.api.collection.empty_desc", "Tải lên ảnh/video hoặc thêm hình nền đang hiển thị");

    isSelectMode = false;
    selectedItemIds.clear();

    const selectModeBtn = wrapper.querySelector("#coll_select_mode_btn");
    const selectSpan = selectModeBtn.querySelector("span");

    const bulkDeleteBtn = wrapper.querySelector("#coll_bulk_delete_btn");
    bulkDeleteBtnRef = bulkDeleteBtn;

    selectModeBtn.addEventListener("mousedown", () => {
        isSelectMode = !isSelectMode;
        selectedItemIds.clear();

        if (isSelectMode) {
            selectSpan.textContent = t("sp.api.collection.cancel_select_mode", "Hủy chọn");
            const iconElem = selectModeBtn.querySelector("svg, i");
            if (iconElem) iconElem.outerHTML = Icons.close;
            grid.classList.add("bg_coll_select_mode");
            if (uploadBtnRef) uploadBtnRef.style.display = "none";
        } else {
            selectSpan.textContent = t("sp.api.collection.select_mode", "Chọn nhiều");
            const iconElem = selectModeBtn.querySelector("svg, i");
            if (iconElem) iconElem.outerHTML = Icons.selectMode;
            grid.classList.remove("bg_coll_select_mode");
            if (uploadBtnRef) uploadBtnRef.style.display = "flex";
        }

        grid.querySelectorAll(".bg_coll_card_selected").forEach((c) => c.classList.remove("bg_coll_card_selected"));
        updateBulkDeleteBtn();
    });

    bulkDeleteBtn.addEventListener("click", async (e) => {
        if (!isSelectMode || selectedItemIds.size === 0) return;

        const count = selectedItemIds.size;
        const msg = t("sp.api.collection.bulk_delete_confirm_msg", { count }, `Bạn có chắc chắn muốn xóa ${count} hình nền đã chọn không?`);

        const confirmed = await showConfirm(msg, {
            title: t("sp.api.collection.bulk_delete_confirm_title", "Xác nhận xóa nhiều"),
            okText: t("sp.api.collection.delete_btn", "Xóa"),
            isDanger: true,
            anchor: e
        });

        if (!confirmed) return;

        const idsToDelete = Array.from(selectedItemIds);
        const remaining = await removeMultipleFromCollection(idsToDelete);

        const activeCard = grid.querySelector(".bg_coll_card_active");
        if (activeCard && idsToDelete.includes(activeCard.dataset.id)) {
            if (remaining.length > 0) {
                await providerManager.applyCollectionItem(remaining[0]);
            } else {
                await providerManager.changeWallpaper({ refresh: false });
            }
        }

        isSelectMode = false;
        selectSpan.textContent = t("sp.api.collection.select_mode", "Chọn nhiều");
        const iconElem = selectModeBtn.querySelector("svg, i");
        if (iconElem) iconElem.outerHTML = Icons.selectMode;
        grid.classList.remove("bg_coll_select_mode");
        selectedItemIds.clear();
        if (uploadBtnRef) uploadBtnRef.style.display = "flex";
        updateBulkDeleteBtn();
        await renderGrid(remaining, grid, emptyState);
    });

    const style = document.createElement("style");
    style.textContent = `
        .bg_coll_select_mode .bg_coll_card_actions, .bg_coll_select_mode .bg_coll_set_btn {
            display: none !important;
        }
        .bg_coll_card_selected .bg_coll_thumb_wrapper::after {
            content: attr(data-index);
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(2);
            background-color: var(--accent);
            color: var(--bg);
            border-radius: 50%;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10;
            font-size: 18px;
            font-weight: bold;
            opacity: 0.7;
            animation: selectFade 1s ease-out;
        }
        @keyframes selectFade {
            0% { opacity: 1; }
            100% { opacity: 0.7; }
        }
        .bg_coll_card_selected .bg_coll_thumb {
            opacity: 0.3;
        }
    `;
    wrapper.appendChild(style);

    getCollection().then((items) => renderGrid(items, grid, emptyState));

    uploadBtn.addEventListener("mousedown", () => fileInput.click());

    fileInput.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        uploadBtn.disabled = true;
        uploadBtn.querySelector("span").textContent = t("sp.api.collection.processing", "Đang xử lý...");

        let successCount = 0;

        for (const file of files) {
            try {
                const isVideo = file.type.startsWith("video/");

                if (isVideo && file.size > 500 * 1024 * 1024) {
                    showNotification(t("sp.api.local.video_too_large"), "error");
                    continue;
                } else if (isVideo && file.size > 100 * 1024 * 1024) {
                    showNotification(t("sp.api.local.video_large_warning"), "warning");
                }

                const thumbnail = isVideo ? await generateVideoThumbnail(file) : await generateImageThumbnail(file);

                let width = 0,
                    height = 0;
                if (!isVideo) {
                    ({ width, height } = await getImageDimensions(file));
                }

                await addToCollection({
                    type: isVideo ? "local_video" : "local_image",
                    blob: file,
                    thumbnail,
                    metadata: {
                        width,
                        height,
                        size: file.size,
                        source: "local",
                        mimeType: file.type,
                    },
                });
                successCount++;
            } catch (err) {
                console.error(`[Collection] Failed to process file "${file.name}":`, err);
                showNotification(t("sp.api.collection.upload_error", { file: file.name }, `Lỗi khi xử lý: ${file.name}`), "error");
            }
        }

        fileInput.value = "";
        uploadBtn.disabled = false;
        uploadBtn.querySelector("span").textContent = t("sp.api.collection.upload_btn", "Tải lên ảnh / video");

        if (successCount > 0) {
            const updated = await getCollection();
            await renderGrid(updated, grid, emptyState);
            showNotification(t("sp.api.collection.upload_success", { count: successCount }, `Đã tải lên ${successCount} file thành công`), "success");
        }
    });

    return wrapper;
}

export function cleanupCollectionUI() {
    activeThumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
    activeThumbnailUrls.clear();
    isSelectMode = false;
    selectedItemIds.clear();
    bulkDeleteBtnRef = null;
    uploadBtnRef = null;
}

async function renderGrid(items, grid, emptyState) {
    const scrollContainer = grid.closest(".submenu_body") || grid.closest(".bg_collection_popup") || grid.parentElement;
    const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    activeThumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
    activeThumbnailUrls.clear();

    grid.innerHTML = "";

    if (!items || items.length === 0) {
        emptyState.style.display = "flex";
        grid.style.display = "none";
        return;
    }

    emptyState.style.display = "none";
    grid.style.display = "grid";

    const { getSettings } = await import("/src/core/storageHandler.js");
    const activeId = getSettings().wallpaperConfig?.activeCollectionItemId;

    const fragment = document.createDocumentFragment();
    for (const item of items) {
        const card = createCardElement(item, activeId, grid, emptyState);
        fragment.appendChild(card);
    }
    grid.appendChild(fragment);

    if (scrollContainer) {
        scrollContainer.scrollTop = savedScrollTop;
    }
}

function createCardElement(item, activeId, grid, emptyState) {
    const card = document.createElement("div");
    card.className = "bg_coll_card";
    card.dataset.id = item.id;

    if (isSelectMode) {
        grid.classList.add("bg_coll_select_mode");
        if (selectedItemIds.has(item.id)) {
            card.classList.add("bg_coll_card_selected");
        }
    }

    const thumbWrapper = document.createElement("div");
    thumbWrapper.className = "bg_coll_thumb_wrapper";

    const isVideo = item.type === "local_video" || item.type === "video" || (item.blob && item.blob.type.startsWith("video/"));

    let thumbImg;

    if (item.thumbnail && item.thumbnail instanceof Blob) {
        thumbImg = document.createElement("img");
        thumbImg.className = "bg_coll_thumb";
        thumbImg.alt = "Thumbnail";
        const url = URL.createObjectURL(item.thumbnail);
        activeThumbnailUrls.add(url);
        thumbImg.src = url;
    } else if (item.blob && item.blob instanceof Blob && item.blob.type.startsWith("image/")) {
        thumbImg = document.createElement("img");
        thumbImg.className = "bg_coll_thumb";
        thumbImg.alt = "Thumbnail";
        const url = URL.createObjectURL(item.blob);
        activeThumbnailUrls.add(url);
        thumbImg.src = url;
    } else {
        thumbImg = document.createElement("div");
        thumbImg.className = "bg_coll_thumb bg_coll_no_thumb";
        thumbImg.innerHTML = isVideo ? Icons.videoBadge : Icons.imageBadge;
    }


    const actions = document.createElement("div");
    actions.className = "bg_coll_card_actions";

    const setBtn = document.createElement("button");
    setBtn.className = "bg_coll_set_btn";
    setBtn.textContent = item.id === activeId ? t("sp.api.collection.currentWallpaper", "Đã đặt") : t("sp.api.collection.setWallpaper", "Đặt làm nền");
    if (item.id === activeId) setBtn.disabled = true;

    setBtn.addEventListener("mousedown", async (e) => {
        e.stopPropagation();
        if (isSelectMode) return;
        if (card.classList.contains("bg_coll_card_active")) return;

        setBtn.disabled = true;

        try {
            await providerManager.applyCollectionItem(item);

            grid.querySelectorAll(".bg_coll_card_active").forEach((c) => {
                c.classList.remove("bg_coll_card_active");
                const oldBtn = c.querySelector(".bg_coll_set_btn");
                if (oldBtn) {
                    oldBtn.disabled = false;
                    oldBtn.textContent = t("sp.api.collection.setWallpaper", "Đặt làm nền");
                }
            });

            card.classList.add("bg_coll_card_active");
            setBtn.textContent = t("sp.api.collection.currentWallpaper", "Đã đặt");
        } catch (err) {
            setBtn.disabled = false;
            showNotification(t("sp.api.collection.apply_error", "Lỗi khi áp dụng hình nền"), "error");
        }
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "bg_coll_remove_btn";
    removeBtn.innerHTML = Icons.collectionRemove;
    removeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (isSelectMode) return;

        const confirmed = await showConfirm(t("sp.api.collection.delete_msg", "Bạn có chắc chắn muốn xóa hình nền này khỏi bộ sưu tập?"), {
            title: t("sp.api.collection.delete_title", "Xác nhận xóa"),
            okText: t("sp.api.collection.delete_btn", "Xóa"),
            isDanger: true,
            anchor: e
        });

        if (!confirmed) return;

        card.style.transition = "opacity 0.2s ease, transform 0.2s ease";
        card.style.opacity = "0";
        card.style.transform = "scale(0.9)";

        setTimeout(async () => {
            const remaining = await removeFromCollection(item.id);
            if (card.classList.contains("bg_coll_card_active")) {
                if (remaining.length > 0) {
                    await providerManager.applyCollectionItem(remaining[0]);
                } else {
                    await providerManager.changeWallpaper({ refresh: false });
                }
            }
            await renderGrid(remaining, grid, emptyState);
        }, 200);
    });

    const actionRow = document.createElement("div");
    actionRow.className = "bg_coll_action_row";

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "bg_coll_download_btn";
    downloadBtn.title = t("sp.api.collection.downloadTooltip", "Tải về");
    downloadBtn.innerHTML = Icons.collectionDownload;

    if (item.type && item.type.startsWith("local")) {
        downloadBtn.disabled = true;
    } else {
        downloadBtn.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            if (isSelectMode) return;
            if (item.blob) {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(item.blob);
                a.download = `wallpaper_${item.id}.jpg`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            } else {
                showNotification(t("sp.api.collection.download_error", "Không tìm thấy dữ liệu ảnh để tải"), "error");
            }
        });
    }

    const sourceBtn = document.createElement("button");
    sourceBtn.className = "bg_coll_source_btn";
    sourceBtn.title = t("sp.api.collection.sourceTooltip", "Xem nguồn");
    sourceBtn.innerHTML = Icons.collectionSource;
    if (item.metadata?.source && !(item.type && item.type.startsWith("local"))) {
        sourceBtn.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            if (isSelectMode) return;
            window.open(item.metadata.source, "_blank");
        });
    } else {
        sourceBtn.disabled = true;
    }

    actionRow.append(downloadBtn, sourceBtn, removeBtn);

    actions.append(setBtn, actionRow);

    if (item.id === activeId) {
        card.classList.add("bg_coll_card_active");
    }

    const info = document.createElement("div");
    info.className = "bg_coll_info";

    const typeKey = isVideo ? "typeVideo" : "typeImage";
    const mediaType = t(`sp.api.collection.${typeKey}`, isVideo ? "Video" : "Ảnh");

    let srcVal = t("sp.api.collection.sourceUnknown", "Không xác định");
    const rawSource = item.metadata?.source || "";
    const providerKey = item.metadata?.provider || "";
    const providerName = item.metadata?.providerName || "";

    if (providerName && providerKey !== "local") {
        srcVal = providerName;
    } else if (rawSource === "local" || providerKey === "local" || (item.type && item.type.startsWith("local"))) {
        srcVal = t("sp.api.collection.sourceLocal", "Local");
    } else if (providerKey === "wallhaven" || rawSource.includes("wallhaven.cc")) {
        srcVal = "Wallhaven";
    } else if (providerKey === "picre" || rawSource.includes("pic.re")) {
        srcVal = "Picre";
    } else if (rawSource) {
        srcVal = rawSource;
    }

    const sizeMB = item.metadata?.size ? (item.metadata.size / 1024 / 1024).toFixed(1) + " MB" : "";
    const res = item.metadata?.width && item.metadata?.height ? `${item.metadata.width}x${item.metadata.height}` : "";

    const metaText = [sizeMB, res].filter(Boolean).join(" | ");
    info.innerHTML = `
        <span class="bg_coll_info_src">${mediaType} | ${srcVal}</span>
        <span style="flex-grow:1"></span>
        <span class="bg_coll_info_meta">${metaText}</span>
    `;

    thumbWrapper.append(thumbImg, actions);
    card.append(thumbWrapper, info);

    card.addEventListener("mousedown", (e) => {
        if (!isSelectMode) return;
        e.preventDefault();
        if (selectedItemIds.has(item.id)) {
            selectedItemIds.delete(item.id);
            card.classList.remove("bg_coll_card_selected");
        } else {
            selectedItemIds.add(item.id);
            card.classList.remove("bg_coll_card_selected");
            // Force reflow to re-trigger CSS animation
            void card.offsetWidth;
            card.classList.add("bg_coll_card_selected");
        }
        updateSelectionIndices();
        updateBulkDeleteBtn();
    });

    return card;
}
