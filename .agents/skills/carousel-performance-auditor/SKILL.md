---
name: carousel-performance-auditor
description: >-
  Audits, benchmarks, and debugs CarouselEngine performance, spring physics, and frame jitter.
  Use when modifying 2D accordion dynamic-width strip mechanics, geometry, animations, or when diagnosing jitter, VRAM, and layer promotion issues.
---

# Carousel Performance & Jitter Auditor

Cẩm nang kiểm thử, chẩn đoán hiệu năng, vật lý lò xo và đo độ giật (jitter) cho hệ thống **2D Accordion CarouselEngine** (`src/wallpaper/frontend/switcher/carousel/`).

---

## 1. Nguyên tắc Chuyển động Cốt lõi

Carousel là một **dải thẻ phẳng 2D co dãn bề rộng động (accordion)**, điều khiển bởi mô hình lò xo tới hạn (critically damped spring) trong `physics.js`:
- **Không dùng CSS Transition / Fixed Tween**: Mọi chuyển động phải được tính toán liên tục qua từng frame bằng tích phân lò xo để không bị giật khi đổi hướng (retarget).
- **Zero Jump at Retarget ($\le 1\text{px}$)**: Khi đang lướt mà nhận lệnh mới, frame tiếp theo phải tiếp nối từ tọa độ hiện tại trên DOM, không được nhảy tức thời.
- **Tính đơn điệu**: Vuốt 1 chiều thì tọa độ (`xRev = 0`) và chỉ số ảo (`ciReversals = 0`) không được thụt lùi hay rung lắc.
- **Duy nhất 1 thẻ active (`activeCount = 1`)**: Tại mọi frame render, luôn luôn có đúng 1 thẻ mang class `.active`.

---

## 2. Lệnh Chạy Kiểm thử

> [!WARNING]
> Theo `base_rules.md`, **không tự ý chạy test sau mỗi lần sửa code**. Chỉ chạy khi người dùng yêu cầu kiểm tra hiệu năng/jitter hoặc chuẩn bị commit.

### Kiểm thử Jitter (Headless)
```powershell
pnpm run test:jitter
```
*Chạy 12 kịch bản đo độ giật trong `tests/carousel-jitter/jitter.test.js`.*

### Kiểm thử Ảo hoá Viewport (Headless)
```powershell
node --test "tests/carousel-perf/viewport.test.js"
```

### Visual Harness (mở trên trình duyệt)
- **Jitter Harness**: `tests/carousel-jitter/harness.html`
- **Performance & VRAM HUD**: `tests/carousel-perf/index.html`

---

## 3. Bảng Tra cứu Chẩn đoán Lỗi (Diagnostic Matrix)

Khi chạy `pnpm run test:jitter`, đối chiếu các cột bị cảnh báo đỏ trong báo cáo terminal để định vị file cần sửa:

| Cột chỉ số | Ngưỡng an toàn | Dấu hiệu lỗi | Nguyên nhân & File cần sửa |
| :--- | :--- | :--- | :--- |
| **`jump@retarget x`** | $\le 1.0\text{px}$ | $> 1.0\text{px}$ | **Gãy tọa độ**: Khi retarget, layout tính từ tọa độ đích cũ thay vì tọa độ thực tế đang render trên DOM. $\to$ Sửa trong `geometry.js`. |
| **`ΔvMax px/s`** | $\le 0.9 \times v_{max}$ | $> 0.9 \times v_{max}$ | **Đứt gãy gia tốc**: Reset vận tốc về $0$ hoặc đổi phương trình chuyển động đột ngột giữa chừng. $\to$ Sửa hàm tích phân lò xo trong `physics.js`. |
| **`xRev`** | $= 0$ (vuốt 1 chiều) | $\ge 1$ | **Rung lắc / Dao động**: Damping ratio bị underdamped khiến lò xo bị dội ngược. $\to$ Kiểm tra hệ số cản trong `physics.js`. |
| **`op violations`** | $= 0$ | $> 0$ | **Nhấp nháy độ mờ**: Độ mờ đổi nhanh hơn độ dốc hàm khoảng cách ($0.2 \times \Delta ci$). $\to$ Sửa bảng `opacityCurve` trong `geometry.js`. |
| **`active-count`** | $= 0$ vi phạm | $> 0$ | **Lệch active**: Có frame không có thẻ nào hoặc có $>1$ thẻ mang class `.active`. $\to$ Sửa logic gán class trong `items.js`. |

---

## 4. Quy chuẩn Ảo hóa Viewport & Bộ nhớ GPU

1. **Giao cắt thực tế**: Chỉ nạp ảnh và gán class `.is-onscreen` cho thẻ nằm trong khung nhìn:
   $$\text{left} + \text{width} > 0 \quad \text{và} \quad \text{left} < \text{viewportWidth}$$
2. **Thu hồi tài nguyên**: Khi thẻ lọt ra ngoài màn hình (hoặc khi resize cửa sổ), gỡ bỏ class `.is-onscreen` và giải phóng `background-image` để giảm tải VRAM GPU.

---

## 5. Checklist trước khi sửa Code Carousel

Khi can thiệp vào `src/wallpaper/frontend/switcher/carousel/` (`CarouselEngine.js`, `geometry.js`, `physics.js`, `items.js`):
- [ ] Không thay thế tích phân lò xo trong `physics.js` bằng CSS transition hay tween thời gian cố định.
- [ ] Giữ nguyên đà kéo (`drag flick velocity`) khi người dùng nhả chuột để làm vận tốc đầu vào cho lò xo.
- [ ] Đảm bảo cơ chế deduplication: mỗi wallpaper ID chỉ có duy nhất 1 thẻ DOM đại diện trong `items.js`.
- [ ] Khi được yêu cầu kiểm thử, chạy `pnpm run test:jitter` và đảm bảo toàn bộ chỉ số trong bảng báo cáo đều xanh.
