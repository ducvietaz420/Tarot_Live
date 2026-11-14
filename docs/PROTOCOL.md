# TikFinity Event API

Ứng dụng nhận sự kiện qua **một kết nối WebSocket tại backend**, mặc định `ws://localhost:21213/`. Chạy TikFinity Desktop cùng máy. Không dùng cookie TikTok hoặc kết nối TikTok trực tiếp. Frontend nhận snapshot của backend, không mở kết nối TikFinity.

Tài liệu đối chiếu ngày 14/11/2026:

- [TikFinity Event API](https://tikfinity.zerody.one/tiktok/dapi): nguồn sự kiện Desktop. Trang công khai được dựng bằng JavaScript; chưa xác nhận payload của phiên bản Desktop trên máy phát thật.
- [Thay đổi payload upstream](https://ttlc.docs.isaackogan.com/getting-started/migration/): giải thích khác biệt giữa dạng phẳng cũ và dạng lồng mới. Schema upstream không chứng minh TikFinity Desktop đang dùng phiên bản nào.
- [Quà và combo](https://ttlc.docs.isaackogan.com/guides/gifts/): combo loại 1 có số lượng cộng dồn; `giftId` định danh loại quà, không định danh giao dịch.
- [Chat và người xem](https://ttlc.docs.isaackogan.com/events/chat-and-audience/): mô tả chat, tim và snapshot người xem.

## Chuẩn hóa có kiểm tra

Envelope: `{ "event": "chat", "data": {} }`. Các sự kiện được xử lý: `chat`, `gift`, `like`, `follow`, `share`, `roomUser`, `subscribe`. Loại khác chỉ ghi nhật ký.

| Dữ liệu nội bộ | Dạng phẳng | Dạng lồng |
| --- | --- | --- |
| Câu bình luận | `comment` | `content` |
| ID tài khoản | `userId` | `user.id` |
| Tên tài khoản | `uniqueId` | `user.displayId` |
| Tên hiển thị | `nickname` | `user.nickname` |
| ID sự kiện | `msgId` | `common.msgId` |
| ID phòng | `roomId` | `common.roomId` |
| Loại combo | `giftType` | `gift.type` |
| Xu cho một quà | `diamondCount` | `gift.diamondCount` |
| Tim tăng thêm | `likeCount` | `count` |
| Tổng tim | `totalLikeCount` | `total` |

Không yêu cầu mọi field đều có. ID được giữ dạng chuỗi; số vượt giới hạn nguyên an toàn bị từ chối. Không dùng nickname hoặc `uniqueId` thay ID ổn định để ghép quà. Nếu hai field ID mâu thuẫn, không gán người. Avatar lỗi có hình dự phòng; demo dùng tranh vector gốc trong `/assets/avatars/`.

## Combo, thiếu dữ liệu và giới hạn

`repeatCount` là số cộng dồn của combo. Dãy `1 → 2 → 3 → kết thúc 3` cho tổng 3 quà. `repeatEnd` chuẩn hóa từ boolean, `0/1` hoặc chuỗi tương ứng. `groupId`/`comboId`, tài khoản, loại quà và phòng giúp phân biệt combo; không gộp mọi quà cùng người/cùng loại.

Engine chốt credit sau sự kiện kết thúc. Nếu thiếu ID combo nhưng có ID sự kiện kết thúc, khả năng chống lặp giới hạn ở ID đó và admin thấy cảnh báo. Thiếu định danh hoặc metadata quan trọng thì cần đối soát; không đoán giá trị xu. Bảng quy đổi của admin bổ sung giá trị đã biết. Xu không được quy đổi ra doanh thu tiền mặt.

Tim theo delta và tổng được xử lý riêng; snapshot `roomUser` không tạo danh sách đầy đủ hay sự kiện từng người vào phòng. Follow/share chỉ hiện cảm ơn. Trạng thái nối socket tách khỏi thời điểm nhận sự kiện LIVE cuối.

Reconnect dùng backoff tối đa 30 giây và loại bỏ callback của socket cũ. Dấu chống lặp, combo và credit nằm trong SQLite. Các fixture kiểm thử mô phỏng schema được tài liệu mô tả; cần kiểm tra log với chat, quà đơn, combo và tim LIVE thật trước khi phát chính thức.

Event API trong project chỉ là nguồn nhận sự kiện. AI và TTS là provider riêng của ứng dụng; không gửi lời đọc hay bình luận ngược qua TikFinity.
