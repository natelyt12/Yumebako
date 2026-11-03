---
name: carousel-performance-auditor
description: >-
  Audits, benchmarks, and debugs CarouselEngine performance, spring physics, and frame jitter.
  Use when modifying 2D accordion dynamic-width strip mechanics, geometry, animations, or when diagnosing jitter, VRAM, and layer promotion issues.
---

# Carousel Performance & Jitter Auditor

Tài liệu hướng dẫn quy trình kiểm thử, chẩn đoán hiệu năng, vật lý lò xo và đo độ giật (jitter) cho hệ thống **2D Dynamic-Width (Accordion) Wallpaper CarouselEngine**.

---

## 1. Bản chất Hình học & Nguyên lý Vật lý

Carousel của Yumebako thực chất là một **dải thẻ phẳng 2D dạng Accordion (co dãn bề rộng động - dynamic width)**, không sử dụng không gian 3D (không xoay trục Z/Y, không perspective 3D):
- **Cơ chế Accordion**: Thẻ tâm active mở rộng tối đa (`baseWidth` 744px), các thẻ lân cận thu hẹp dần theo đường cong khoảng cách nguyên `percentageCurve = [1.0, 0.3, 0.2, 0.1, 0.05]` và sàn tối thiểu `minWidth = 35px`.
- **Cơ chế Chuyển động**: Khi lướt qua lại, engine nội suy tuyến tính giữa 2 layout nguyên theo tỷ lệ $t \in [0, 1)$, kết hợp với mô hình **Lò xo tới hạn (Critically Damped Spring)** để điều khiển vị trí ảo $continuousIndex$.

Carousel **không sử dụng CSS Transition hay Tween thời lượng cố định**, mà tuân thủ các bất biến vật lý nghiêm ngặt:

1. **Tính liên tục của vận tốc (Velocity Continuity)**:
   - Vận tốc ($v$) là biến trạng thái liên tục của chuyển động, không bao giờ được phép gán đột ngột về $0$.
   - **Lỗi phổ biến của Tween**: Khi người dùng vuốt tiếp trong lúc dải đang lướt (retarget), tween thông thường sẽ reset vận tốc về $0$ và dựng frame đầu tiên với độ dốc lớn nhất $\to$ gây khựng mắt ngay lập tức.
   - **Quy chuẩn Lò xo**: Bước nhảy vận tốc giữa hai frame liền kề không được vượt quá $90\%$ vận tốc đỉnh:
     $$\frac{\Delta v_{max}}{v_{max}} \le 0.9$$
     *(Với $\omega = 10 / 0.6$ và 60fps, lò xo tới hạn có tỉ lệ tự nhiên $\approx 0.76$).*

2. **Nối tiếp tọa độ tuyệt đối khi Retarget (Zero Jump at Retarget)**:
   - Khi dải đang bay mà nhận lệnh đổi đích (`retarget`), frame đầu tiên của pha mới phải bắt đầu chính xác từ tọa độ và độ rộng hiện hữu trên DOM:
     $$\text{jump@retarget}_x \le 1\text{px}$$
     *(Chỉ chấp nhận sai số làm tròn số học $\le 1\text{px}$, không được có cú nhảy layout).*

3. **Bất biến Đơn điệu khi Vuốt 1 Chiều (Monotonic Invariants)**:
   - `xRev = 0`: Tọa độ thẻ không được rung lắc thụt lùi sang chiều ngược lại.
   - `ciReversals = 0`: Chỉ số vị trí ảo `continuousIndex` không được đổi chiều.
   - `activeRegressions = 0`: Thẻ `active` chỉ được tịnh tiến tới, không được nhảy lùi.
   - `activeCount = 1`: Tại mọi frame render, luôn luôn có **đúng 1 thẻ** mang class `active`.

4. **Độ mờ tuân thủ Hàm khoảng cách (Opacity Slope Invariant)**:
   - Đường cong độ mờ `opacityCurve = [1, 0.9, 0.7, 0.5, 0.3, 0.1]` có độ dốc cực đại là $0.2$.
   - Độ mờ một thẻ không bao giờ được đổi nhanh hơn $0.2 \times \Delta\text{continuousIndex}$ trong một frame.

---

## 2. Hệ thống Đo lường (Harness & Probe)

Phép đo không dùng `requestAnimationFrame` ngẫu nhiên của CPU, mà dùng môi trường giả lập chuẩn xác:
- **`virtualClock.js`**: Tua từng tick frame cố định ($16.66\text{ms}$) để đảm bảo kết quả đo lặp lại được $100\%$.
- **`probe.js`**: Bọc `geometry.applyLayout()`, chụp lại snapshot của từng thẻ (`width`, `translateX`, `opacity`, `active`) tại mỗi frame render.
- **`scenario.js`**: Phát các chuỗi sự kiện `wheel` hoặc `drag` theo các kịch bản thực tế (lướt chậm, retarget liên tục, kéo nhả nhanh tạo đà, kéo quá mép dải).

---

## 3. Quy trình Chạy Kiểm thử

> [!WARNING]
> Theo `base_rules.md`, **không tự ý chạy test sau mỗi lần sửa code**. Chỉ chạy khi người dùng yêu cầu kiểm tra hiệu năng/jitter hoặc chuẩn bị commit.

### Chạy kiểm thử Jitter (Headless)
```powershell
pnpm run test:jitter
```
*Lệnh này chạy toàn bộ 12 test trong `tests/carousel-jitter/jitter.test.js`.*

### Chạy kiểm thử Ảo hóa Viewport (Headless)
```powershell
node --test "tests/carousel-perf/viewport.test.js"
```

### Mở Harness trực quan trên Trình duyệt
- **Jitter Harness**: `tests/carousel-jitter/harness.html`
- **Performance & VRAM HUD**: `tests/carousel-perf/index.html`

---

## 4. Hướng dẫn Đọc & Chẩn đoán Bảng Báo cáo (`formatReport`)

Khi chạy `test:jitter`, terminal sẽ in ra bảng số liệu của từng kịch bản. Dưới đây là cách phân tích từng cột:

```text
── fast sweep — retarget liên tục ──
frames=184  epochs=12  retarget-frames=11
card      | maxΔx    maxΔw    maxΔop  | jump@retarget x/w      | xRev wDir | vMax px/s   ΔvMax px/s | op[min..max]
card-0    |  42.50px  14.20px   0.082 |    0.00px    0.00px    |    0    0 |       1450         920 | 0.100..1.000
card-1    |  51.10px  18.00px   0.091 |    0.35px    0.10px    |    0    0 |       1820        1150 | 0.100..1.000
worst jump anywhere: 0.35px (sample 42, card-1)
violations: active-count=0 opacity=0 [active-regress=0 ci-reversal=0]
```

### Bảng tra cứu chẩn đoán (Diagnostic Matrix)

| Chỉ số / Cột | Ngưỡng an toàn | Dấu hiệu vi phạm | Nguyên nhân gốc rễ & Cách khắc phục |
| :--- | :--- | :--- | :--- |
| **`jump@retarget x`** | $\le 1.0\text{px}$ | $> 1.0\text{px}$ | **Gãy layout**: Khi nhận lệnh mới, engine đã tính lại layout từ tọa độ đích của thẻ cũ thay vì lấy tọa độ thực tế đang render trên DOM. |
| **`ΔvMax px/s`** | $\le 0.9 \times v_{max}$ | $> 0.9 \times v_{max}$ | **Đứt gãy gia tốc**: Reset vận tốc về $0$ hoặc thay đổi phương trình chuyển động giữa chừng. Kiểm tra lại hàm tích phân lò xo trong `spring.js`. |
| **`xRev`** | $= 0$ (khi vuốt 1 chiều) | $\ge 1$ | **Rung lắc**: Sai số tích phân hoặc damping ratio quá nhỏ khiến lò xo bị dao động tắt dần (dưới mức tới hạn - underdamped). |
| **`op violations`** | $= 0$ | $> 0$ | **Nhấp nháy mờ**: `layoutCenterIndex` tính lệch so với `continuousIndex` trong pha thu cột / xóa thẻ. |
| **`active-count`** | $= 0$ vi phạm | $> 0$ | **Lệch trạng thái active**: Có frame không có thẻ nào active hoặc có từ 2 thẻ active trở lên. |

---

## 5. Quy chuẩn Ảo hóa Viewport & Bộ nhớ GPU (VRAM)

Để startpage hiển thị mượt và nhẹ trên Chrome Extension với hàng trăm hình nền:

### 1. Thuật toán Cắt Viewport (`geometry.computeLayout`)
- **Không dùng offset cố định**: Không bao giờ giới hạn theo kiểu `Math.abs(index - center) <= 7`.
- **Giao cắt hình học thực tế**: Chỉ nạp ảnh và gán class `.is-onscreen` cho thẻ có vùng hiển thị giao cắt với chiều rộng màn hình:
  $$\text{left} + \text{width} > 0 \quad \text{và} \quad \text{left} < \text{viewportWidth}$$
- Khi thu nhỏ kích thước cửa sổ (`resize`), các thẻ lọt ra ngoài phải lập tức gỡ bỏ `background-image` và gỡ class `.is-onscreen`.

### 2. Công thức Ước tính VRAM
Trình duyệt không cung cấp API đọc VRAM theo tab. Performance harness ước tính VRAM theo công thức:
$$\text{VRAM}_{\text{total}} = N_{\text{layer}} \times (744 \times 420 \times 4 \times \text{DPR}^2) + N_{\text{thumb}} \times (640 \times 360 \times 4 \times \text{DPR}^2)$$

*Trong đó $N_{\text{layer}}$ chính là số lượng thẻ đang mang class `.is-onscreen`.*

---

## 6. Checklist trước khi sửa đổi Code Carousel

Khi được yêu cầu can thiệp vào `src/wallpaper/frontend/switcher/carousel/` (`CarouselEngine.js`, `geometry.js`, `physics/`):
- [ ] Không thay thế logic tích phân lò xo bằng CSS transition hay hàm tween thời gian cố định.
- [ ] Giữ nguyên đà kéo (`drag flick velocity`) khi người dùng buông tay để truyền vào vận tốc đầu vào của lò xo.
- [ ] Đảm bảo cơ chế deduplication: mỗi wallpaper ID chỉ có duy nhất 1 DOM node đại diện.
- [ ] Sau khi sửa xong và được người dùng yêu cầu test, chạy `pnpm run test:jitter` và `node --test "tests/carousel-perf/viewport.test.js"`, kiểm tra bảng báo cáo đảm bảo mọi chỉ số đều nằm trong ngưỡng xanh.
