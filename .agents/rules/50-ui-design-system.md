---
trigger: glob
globs: "apps/web/**/*.{tsx,css},packages/ui/**/*"
---

# UI rules — "Creative Dark Studio"

- Trước khi viết HTML/CSS/client JS mới: dùng skill `modern-web-guidance` (bắt buộc theo workspace).
- Token màu/khoảng cách/radius chỉ lấy từ `docs/nova/06-UI-UX.md` (CSS variables + Tailwind theme). Không hard-code hex.
- Component nền: shadcn/ui trong `packages/ui`. Icon: `lucide-react`.
- Mọi hành động chính có phím tắt (bảng trong 06-UI-UX). Hiển thị trong tooltip.
- A11y: focus ring rõ, điều hướng bàn phím cho panel/menu, `aria-label` cho icon button, tương phản ≥ 4.5:1 cho text.
- Canvas không re-render cả cây React khi kéo; state nóng (drag, cursor) đi thẳng vào Konva layer.
- Trạng thái rỗng / loading / lỗi / offline-reconnecting phải có UI riêng.
- Mỗi màn hình hoàn thành phải có ảnh chụp Playwright lưu ở `harness/evals/screenshots/` làm bằng chứng.
