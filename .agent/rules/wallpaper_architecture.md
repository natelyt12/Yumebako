---
trigger: manual
---

# Wallpaper Architecture & Data Flow Rules

Tài liệu này quy định kiến trúc 4 tầng chuẩn của hệ thống Wallpaper Switcher trong Yumebako. Bất kỳ AI Agent hoặc lập trình viên nào khi chỉnh sửa, thêm tính năng hoặc refactor hệ thống Wallpaper đều **BẮT BUỘC TUÂN THỦ** các nguyên tắc dưới đây.

---

## 1. Mô hình 4 Tầng (Four-Layer Architecture)

```
┌──────────────────────────────────────────────────────────┐
│  TẦNG 1: UI LAYER (CarouselEngine, SwitcherBar, CSS)     │
│  - Render danh sách thẻ & card '+' ảo                    │
│  - Bắt gesture drag / scroll / keyboard                   │
│  - Phát sinh Soft Select & Hard Select sang Tầng 2       │
└──────────────────────────┬───────────────────────────────┘
                           │ (events / calls)
                           ▼
┌──────────────────────────────────────────────────────────┐
│  TẦNG 2: DATA CONTROL (DataControl.js - SSOT)            │
│  - Single Source of Truth, Pub/Sub Event Emitter         │
│  - Giữ mảng cards SẠCH (không chứa thẻ ảo kind: 'more')  │
│  - Quản lý currentIndex (Hard) & softIndex (Soft)         │
│  - Tự động nhớ/khôi phục index cho từng tab (sourceIndices)│
│  - Giao tiếp với IndexedDB (BakoDB / appData)            │
└──────────────┬───────────────────────────┬───────────────┘
               │                           │
               ▼                           ▼
┌──────────────────────────────┐ ┌─────────────────────────┐
│ TẦNG 3: SOURCE ADAPTERS      │ │ TẦNG 4: RENDERER        │
│ (BaseSource, RemoteSource,   │ │ (renderer.js)           │
│  CollectionSource...)        │ │ - Nghe card:hard từ T2  │
│ - Single-Phase Pipeline      │ │ - Cross-fade background │
│ - Fetch & Seed dữ liệu       │ │ - Áp dụng filter CSS    │
│ - Lưu blob vào mediaData     │ │ - Không quản lý state   │
└──────────────────────────────┘ └─────────────────────────┘
```

---

## 2. Trách nhiệm chi tiết & Ranh giới từng tầng

### Tầng 1: UI Layer (`src/wallpaper/ui/`, `src/wallpaper/core/WallpaperSwitcher.js`)
- **Vai trò:** Trình diễn giao diện, hiệu ứng chuyển động carousel và thanh điều khiển bottom bar.
- **Quy tắc:**
  - **Không gọi trực tiếp DB hay fetch API bên ngoài:** Mọi yêu cầu lấy ảnh, xóa ảnh, đổi nguồn đều phải thông qua các phương thức của `dataControl` (`requestMore()`, `deleteCard()`, `switchSource()`).
  - **Thẻ '+' (Action Card) là thẻ ảo:** Tầng 1 tự chèn thẻ Action Card vào mảng hiển thị nếu `source.showsMoreItem !== false && source.canGrow`.
  - Khi cuộn dừng hẳn (settled), CarouselEngine phát tín hiệu `onHardSelect` -> chuyển sang `dataControl.setHardIndex(index)`.

### Tầng 2: Data Control (`src/wallpaper/core/DataControl.js`)
- **Vai trò:** Bộ não điều phối dữ liệu tập trung duy nhất (Single Source of Truth).
- **Quy tắc:**
  - **Mảng dữ liệu sạch (Clean Items):** `dataControl.items` và key `carousel:{sourceId}` trong IndexedDB **TUYỆT ĐỐI KHÔNG ĐƯỢC CHỨA** thẻ ảo `{ kind: "more" }`.
  - **Quản lý vị trí index:**
    - Khi đổi tab hoặc khởi động (`switchSource`): Tự động khôi phục index theo ảnh đang active trên desktop hoặc đọc từ `settings.wallpaperSwitcher.sourceIndices[sourceId]`.
    - Khi cuộn dừng (`setHardIndex`): Tự động lưu index vào `wallpaperSwitcher.sourceIndices[activeSourceId]`.
    - Khi xóa thẻ (`deleteCard`): Tính lại index kế cận an toàn và cập nhật lại `sourceIndices`.
  - **Pub/Sub Events chuẩn:**
    - `source:change`: Khi bắt đầu chuyển tab nguồn.
    - `cards:loaded`: Khi nạp xong danh sách thẻ của nguồn.
    - `card:soft`: Khi tâm carousel lướt qua thẻ.
    - `card:hard`: Khi cuộn dừng hẳn tại thẻ.
    - `card:added` / `card:deleted`: Khi thêm hoặc xóa thẻ.
    - `feed:exhausted`: Khi nguồn remote đã hết ảnh để nạp.

### Tầng 3: Source Adapters (`src/wallpaper/sources/`)
- **Vai trò:** Cung cấp dữ liệu hình nền từ các nhà cung cấp (Collection nội bộ hoặc API: Picre, Wallhaven, Unsplash...).
- **Quy tắc Single-Phase Pipeline:**
  - Khi fetch ảnh remote: Tải ảnh gốc 1 lần -> Canvas trích xuất thumbnail 16:9 -> Lưu cả 2 vào IndexedDB `mediaData` (`media:orig:${id}` & `media:thumb:${id}`).
  - Không bao giờ tải lại ảnh gốc lần thứ hai khi chuyển đổi hoặc render.
  - Tầng 3 chỉ trả về mảng plain objects chứa metadata chuẩn (`id`, `url`, `thumbnailUrl`, `title`...). Không can thiệp vào DOM hay UI.

### Tầng 4: Renderer (`src/wallpaper/core/renderer.js`)
- **Vai trò:** Hiển thị hình nền lên màn hình Desktop (`.image` / `.video`).
- **Quy tắc:**
  - Chỉ lắng nghe sự kiện `dataControl.on("card:hard", ...)` để đổi hình nền.
  - Xử lý cross-fade mượt mà, CSS filters (blur, brightness, contrast...) và video playback.
  - Không lưu state, không điều khiển ngược lại Tầng 1 hay Tầng 2.

---

## 3. Cấm kỵ (Anti-Patterns)
1. **NGHIÊM CẤM** tạo lại `SwitcherStore.js` hoặc bất kỳ Store phân mảnh nào. Mọi state phải nằm trong `DataControl.js`.
2. **NGHIÊM CẤM** nhét thẻ `{ kind: 'more' }` vào DB hoặc `dataControl.items`.
3. **NGHIÊM CẤM** gọi thẳng `saveToStore('carousel:...')` ngoài phạm vi của `DataControl`.
4. **NGHIÊM CẤM** Tầng 1 (Carousel/SwitcherBar) tự gọi API tải ảnh hoặc tự xóa IndexedDB.
5. Khi thêm nguồn Wallpaper mới: Bắt buộc kế thừa từ `BaseSource` (hoặc `RemoteSource`), khai báo vào `src/wallpaper/sources/registry.js`, và cấu hình defaultSettings trong `src/core/storageHandler.js`.
