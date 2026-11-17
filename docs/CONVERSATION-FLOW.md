# Luồng tham gia và hỏi đáp

## Vào hàng và gọi người xem

- Bình luận **tarot** hoặc tặng quà để vào hàng chờ; mỗi ID tài khoản chỉ có một lượt chưa hoàn tất. Người tặng quà được ưu tiên, sau đó xét xu đã xác nhận và thứ tự vào hàng; giới hạn chờ bảo vệ người vào trước. Không chen ngang người đang được hỏi hoặc đang đọc bài.
- Mặc định tự động gọi người tiếp theo khi sân khấu rảnh. Cấu hình luồng cũ được nâng sang tự động chạy và ưu tiên quà khi cập nhật. Có thể chọn chạy thủ công trong admin.
- Khung giữa overlay gọi đúng tên và hỏi người xem muốn khám phá **Tình duyên, Công việc, Tiền bạc, Học hành hay Gia đình**. Người được gọi có **60 giây** trả lời bằng bình luận thường.
- Nếu chỉ trả lời **Tôi muốn xem về tình duyên**, khung hỏi tiếp điều người đó muốn tìm hiểu trong tình duyên và cấp **60 giây** cho câu trả lời chi tiết. Ví dụ: **Tôi và bạn gái có ở bên nhau dài lâu không?**
- Nếu bình luận đã đủ chủ đề và vấn đề, hệ thống bắt đầu trải bài ngay. Ví dụ: **Tôi muốn xem về tình duyên, tôi và bạn gái có ở bên nhau dài lâu không?** Chỉ đúng tài khoản trong đúng phiên/phòng điền được câu hỏi cho lượt đó.
- Hết 60 giây mà chưa trả lời đủ thì bỏ qua lượt và mời người tiếp theo. Lịch sử, quà và credit vẫn giữ để quản trị đối soát. Sau khi khởi động lại backend, lời mời/hàng chờ đợi quản trị bấm **Bắt đầu**; khi đó thời gian chờ được cấp lại.

## Xào và đọc bài

Chỉ khi đủ chủ đề và câu hỏi, backend mới chốt ba lá khác nhau. Overlay thể hiện xào hai nửa bộ bài xen kẽ, gom lại, xòe bộ bài thành vòng cung rồi chọn ba lá; sau đó lật và đọc từng lá, cuối cùng đọc tổng kết. Refresh không rút lại bài. Giảm chuyển động vẫn hiển thị các bước và ba lá đã chốt.

## Ba câu hỏi tiếp

Phần này chỉ mở cho lượt cá nhân khi **AI cá nhân hóa** và **Cho phép hỏi tiếp sau tổng kết** được bật, đồng thời backend đã cấu hình AI. Khi chưa có AI, phần đọc ba lá bằng nội dung biên soạn vẫn hoạt động nhưng không trả lời câu hỏi tiếp. Lượt chung từ tim không mở hỏi đáp.

1. Đọc xong tổng kết, khung giữa overlay gọi tên người vừa xem, hiển thị số câu còn lại và đồng hồ **30 giây**. Người đó chỉ cần bình luận câu hỏi, chẳng hạn **Tôi nên bắt đầu cuộc trò chuyện với người ấy thế nào?**
2. Nhận câu hỏi thì dừng đồng hồ trong lúc AI tạo và hệ thống đọc câu trả lời. Bình luận của người khác không thay câu hỏi; không nhận dồn các câu tiếp theo khi đang trả lời.
3. Đọc xong mới mở 30 giây mới cho câu kế tiếp. Tối đa **ba câu khác nhau**, dựa trên đúng ba lá và nội dung vừa đọc, không rút thêm bài. Hỏi đủ ba câu hoặc hết một cửa sổ chờ nhập thì kết thúc hỏi đáp và chuyển tiếp hàng chờ sau pha hoàn tất.

Câu hỏi dài 8–500 ký tự, không chứa liên kết. Bình luận xã giao và câu lặp không dùng thêm suất. AI lỗi sẽ báo lỗi và mở lại 30 giây chờ; có thể thử lại cùng câu sau 5 giây, tối đa ba lần tính cả lần đầu. Quản trị có thể nhập giúp, thử lại hoặc kết thúc hỏi đáp sớm.

## Quà và dữ liệu

Vào hàng nhờ quà không đồng nghĩa credit đã được xác nhận. Có ID tài khoản và ID loại quà thì người tặng vẫn được xếp hàng dù giá xu chưa rõ; số xu thiếu hoặc metadata chưa đủ luôn cần kiểm tra, không tự đoán. Combo chỉ chốt credit theo số lượng cuối và bỏ sự kiện lặp. Credit đã dùng không được tái sử dụng; bỏ qua hay hết giờ không tự xóa hoặc hoàn số dư.

DEMO và LIVE tách hàng chờ, sự kiện và credit. Cấu hình dùng chung; bình luận từ phiên hoặc phòng khác không trả lời thay người đang được gọi. Khi nâng phiên bản, cấu hình luồng mới không thay bộ ba và nội dung của lượt đã chốt.
