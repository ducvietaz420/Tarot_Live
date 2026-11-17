# Tiệm Tarot LIVE

Ứng dụng local cho Windows: sân khấu tarot dọc, hàng chờ theo ID tài khoản, ba lá cố định cho mỗi lượt, nội dung tiếng Việt và kết nối sự kiện TikFinity tại backend. DEMO chạy đầy đủ khi chưa LIVE và chưa có API key. Nội dung mang tính giải trí và tự chiêm nghiệm.

Ảnh tham chiếu bố cục đầy đủ không xuất hiện trong dữ liệu được cung cấp ở lần dựng đầu. Giao diện được dựng theo bố cục và bảng màu trong yêu cầu bằng nhân vật tạo riêng, nền huyền học và bộ bài Rider–Waite–Smith; chưa thể xác nhận khớp từng chi tiết của ảnh gốc.

## Chạy trên Windows

Bấm đúp **`START.bat`** hoặc **`START.cmd`** để chạy. Nếu máy chưa có Node.js 24 trở lên hoặc npm, launcher tự tải Node.js 24 kèm npm từ [nodejs.org](https://nodejs.org/en/download) vào `.runtime/node` trong project, kiểm tra SHA-256 rồi dùng ngay, không cần quyền admin. Nếu thiếu thư viện, launcher tự chạy `npm install --include=dev` trước khi build và mở admin. Lần cài đầu cần kết nối Internet; các lần sau dùng lại bộ công cụ và thư viện đã có. SQLite tích hợp trong Node, không cần cài dịch vụ database, Docker hoặc hosting.

Nếu muốn chạy bằng terminal với Node.js 24 trở lên đã cài sẵn:

```powershell
cd 'C:\Downloads\Live Tarot TikTok'
npm install
npm run dev
```

Mở:

- [Admin](http://127.0.0.1:3210/admin): điều hành và cấu hình, mặc định phiên LIVE.
- [Demo](http://127.0.0.1:3210/demo): dữ liệu thử tách khỏi LIVE.
- [Overlay LIVE](http://127.0.0.1:3210/overlay?mode=live): sân khấu 1080 × 1920, giữ tỷ lệ 9:16.
- [Overlay DEMO](http://127.0.0.1:3210/overlay?mode=demo): xem cùng trạng thái với `/demo`.

Để chạy bản đã build:

```powershell
npm run build
npm start
```

Launcher kiểm tra/cài Node.js, npm và thư viện khi thiếu, build, chạy backend ẩn rồi mở admin. **Giữ cửa sổ launcher mở trong lúc sử dụng**: `START.bat` và `START.cmd` bật `-KeepAlive` để giữ tiến trình chạy ổn định. Nếu Tiệm Tarot đã chạy ở cổng đó, script dùng lại phiên, mở admin rồi thoát. Script không dừng tiến trình khác. Nếu tải hoặc cài đặt thất bại, xem lỗi trong cửa sổ launcher, kiểm tra kết nối mạng rồi chạy lại.

Log khởi động và PID ở `data/startup.*.log`, `data/launcher.pid`. Khi muốn dừng bản launcher, xác định đúng PID backend trong Task Manager; cửa sổ launcher đang chờ sẽ kết thúc khi backend dừng. Với terminal `npm run dev`/`npm start`, dùng `Ctrl+C`. Cần khởi động lại backend sau khi sửa biến môi trường. Có thể chạy `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/START-WINDOWS.ps1 -NoBrowser -KeepAlive` để giữ launcher mà không tự mở cửa sổ trình duyệt; `-NoBrowser` và `-KeepAlive` là hai tùy chọn độc lập.

Ứng dụng chỉ bind `127.0.0.1`; không được truy cập từ điện thoại hoặc máy khác bằng IP LAN mặc định. Không mở cổng router. Muốn đổi cổng, sao chép `backend/.env.example` thành `backend/.env` và sửa `PORT`; cập nhật URL nguồn phát tương ứng. File `.env.example` ở gốc chỉ dẫn đến cấu hình backend, không được server nạp.

## Thử ngay khi chưa LIVE

1. Mở `/demo`, chọn **Chạy một lượt demo**. Theo dõi chốt yêu cầu → xào → chia → ba lá → tổng kết → hỏi đáp nếu đã bật AI → hoàn tất.
2. Dùng **10 người · trùng nickname**, **Quà trước câu hỏi**, **Câu hỏi trước quà**, **Combo 1 → 2 → 3 + lặp** và **Tim vượt mốc** để kiểm tra hàng chờ/credit. Hai người trùng nickname có ID riêng.
3. Mở thêm overlay DEMO. Refresh chỉ nhận snapshot, không gọi AI, rút lại bài hoặc tạo lượt mới.
4. Thử tạm dừng, tiếp tục, bỏ qua, đọc lại; thử giả lập AI timeout và TTS lỗi. Các nút lỗi mô phỏng chỉ tác động DEMO; không sửa trạng thái kết nối LIVE thật.

Mặc định: quà đủ **1 xu + câu hỏi**, mục tiêu **3.000 tim**, cửa sổ ghép **5 phút**, chế độ chạy thủ công. Đây là giá trị thử, sửa được ở admin. Cấu hình được dùng chung giữa hai phiên; dữ liệu sự kiện, lượt, credit và tim tách riêng. Không tự đưa người xem hoặc quà demo vào LIVE khi TikFinity mất kết nối.

## Kết nối TikFinity thật

1. Chạy **TikFinity Desktop trên cùng máy với backend**, đăng nhập/kết nối phiên LIVE theo hướng dẫn của TikFinity.
2. Mở **Kết nối & sự kiện** ở admin, chọn LIVE. Endpoint mặc định là `ws://localhost:21213/`; thay URL nếu bản Desktop có cấu hình khác. `TIKFINITY_URL` trong `backend/.env`, khi được đặt, ưu tiên hơn URL đã lưu khi khởi động.
3. Kiểm tra riêng **Đã nối TikFinity** và **Đã nhận sự kiện LIVE**, cùng thời điểm sự kiện cuối. Nối socket chưa chứng minh đã nhận chat/quà.
4. Gửi bình luận và quà đơn thực tế, xem loại sự kiện, trạng thái chuẩn hóa, ID người dùng, giá trị quà và cảnh báo trong log. Sau đó thử một combo ngắn trước khi phát chính thức.

```text
!tarot tình duyên | Tôi nên chú ý điều gì trong mối quan hệ này?
!tarot công việc | Giai đoạn tới tôi nên tập trung vào đâu?
Tình duyên: cho em xem mối quan hệ hiện tại
```

Lệnh `!tarot`, chế độ tham gia và giới hạn sửa được ở **Quy tắc tham gia**. Comment chào hỏi/emoji không tự tạo lượt. Không cần ngày sinh, số điện thoại hoặc cookie TikTok.

Nếu log bắt đầu bằng **Thiếu msgId…**, bình luận vẫn có lớp lọc dự phòng: hash theo ID tài khoản, phòng và nội dung để bỏ bình luận giống nhau trong **5 giây**. Đây là cách chống lặp có giới hạn khi thiếu ID sự kiện, không phân biệt chắc chắn người dùng gõ lại với frame được gửi lại. Không dùng cách này để suy ra giao dịch quà.

Sau khi một lượt **hoàn tất**, cùng tài khoản trong cùng phòng gửi lại đúng chủ đề và câu hỏi sẽ không tạo lượt mới trong **120 giây**, kể cả có `msgId` mới. So sánh bỏ qua hoa/thường và khoảng trắng tương đương, vẫn giữ ý nghĩa dấu tiếng Việt. Gửi câu hỏi khác vẫn theo thời gian nghỉ giữa lượt đã cấu hình; hết 120 giây, câu cũ cũng phải qua quy tắc tham gia và điều kiện quà như bình thường. Credit đã dùng không được cấp lại.

Adapter hỗ trợ envelope `{event,data}`, cả field phẳng cũ và field lồng. Payload của phiên bản TikFinity Desktop thật vẫn cần đối chiếu tại máy phát; không mặc định theo schema upstream mới nhất. `roomUser` chỉ là thông tin thống kê, không tạo người xem riêng hoặc danh sách đầy đủ. AI/TTS không gửi bình luận hay lời đọc ngược qua Event API. Chi tiết, nguồn chính thức và giới hạn ở [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Hàng chờ, quà và đối soát

- Ghép bằng ID tài khoản ổn định, không bằng nickname. Mỗi người tối đa một lượt chưa hoàn tất; câu hỏi được sửa khi còn chờ và khóa ngay khi chốt lượt.
- Ba chế độ: miễn phí qua bình luận; quà + câu hỏi; bình luận vào hàng/quà tăng ưu tiên. FIFO mặc định. Khi bật ưu tiên, chỉ dùng xu đã xác nhận của lượt đang chờ; cùng điểm FIFO và có giới hạn chờ để tránh bị đẩy xuống mãi.
- Quà đến trước hoặc sau câu hỏi trong cửa sổ ghép đều được xử lý. Đủ quà nhưng chưa có câu hỏi sẽ **chờ câu hỏi**; có câu hỏi nhưng thiếu quà sẽ **chờ điều kiện**.
- Combo loại 1 dùng `repeatCount` cộng dồn và chốt credit sau kết thúc: `1,2,3,final 3` chỉ là 3 quà. ID loại quà không phải ID giao dịch. Sự kiện lặp và combo có định danh được lưu dấu trong SQLite.
- Thiếu ID, giá trị xu hoặc metadata thì hiển thị cảnh báo/chờ kiểm tra. Không đoán giá quà, không quy đổi thành doanh thu tiền mặt. Bảng `giftId → xu` chỉ nhập giá đã xác minh. Thay bảng không tự tính lại quà cũ; dùng thao tác xác nhận credit khi cần.
- Quà phát sinh trong lúc đang đọc được giữ riêng cho yêu cầu mới, không tự tạo lượt. Credit đã dùng không tái sử dụng. Bỏ qua/xóa hàng chờ giữ lịch sử; admin xử lý hoàn credit rõ ràng, không âm thầm xóa số dư.
- Credit hết cửa sổ ghép vẫn được giữ để đối soát. Admin có thể xác nhận giá trị, ghép số dư tồn đúng tài khoản hoặc hoàn credit của lượt đã bỏ qua theo tình huống thực tế.

Lượt chung từ tim chỉ vào ranh giới giữa các lượt, không cắt lời đang đọc. Tim delta và tổng tích lũy được phân biệt; tổng tích lũy lấy baseline đầu phiên. Mỗi mốc kích hoạt một lần, giữ phần dư và giới hạn số lượt chung chờ. Khi đổi phòng/phiên, dùng **Bắt đầu phiên mới** sau khi hoàn tất/bỏ qua lượt cũ; phiên cũ được lưu để đối soát. Follow/share hiện lời cảm ơn nhỏ, mặc định không tạo lượt tarot.

## Âm thanh, phụ đề và nguồn phát

Admin/preview mặc định tắt tiếng. Backend chỉ cấp quyền âm thanh cho **một tab trong toàn bộ ứng dụng**, kể cả khi đồng thời mở DEMO và LIVE; các tab khác không tự đọc cùng lượt. Nếu nguồn âm thanh đang ở DEMO, tắt tiếng tại tab đó trước khi bật nguồn LIVE. Chuyển quyền cần thao tác rõ ràng, không tự giành loa từ tab đang phát.

1. Trong **Nội dung & âm thanh**, chọn giọng hệ thống/trình duyệt hoặc TTS HTTP, tốc độ và âm lượng. Nhạc tarot nhẹ có hòa âm và tiếng dây gảy thưa, nối vòng 64 giây; tự giảm còn 40% mức đã chọn khi có lời đọc. Tiếng xào/chia/lật bài có âm lượng riêng, không phụ thuộc âm lượng giọng.
2. Bấm **Kiểm tra âm thanh** tại admin để thử giọng. Thao tác này chỉ mượn quyền âm thanh trong lúc thử, rồi tự trả quyền khi xong hoặc gặp lỗi. **Bật tiếng tại admin** là lựa chọn phát lâu dài tại admin. Danh sách giọng `vi-*` phản ánh khả năng thật của môi trường đó; Windows/Chrome có giọng Việt không có nghĩa Browser Source của OBS cũng có.
3. Mở đúng overlay phát và bấm **Bật âm thanh**. Nếu admin hoặc tab khác trong cùng phiên đang giữ tiếng, overlay hiển thị **Chuyển âm thanh sang overlay này**; bấm để chuyển nguồn, tab cũ sẽ dừng. Nếu dùng OBS Browser Source, dùng thao tác **Interact** của nguồn để bấm nút khi cần. Quyền tự phát của trình duyệt vẫn cần thao tác bật tiếng tại chính nguồn phát.
4. Khi sân khấu nghỉ hoặc tạm dừng, dùng **Nghe thử xào bài** và **Nghe thử nhạc nền** (12 giây) tại admin; các nút nghe thử tự trả quyền khi xong. Sau đó bật nguồn overlay để phát. Theo dõi báo lỗi ở admin. Không có giọng hoặc TTS lỗi vẫn chạy bằng chữ và thời gian giữ nội dung.

Tiếng xào là các nhịp giấy lướt/ruffle suốt pha xào, tiếng chia/lật nhẹ hơn. Ba file âm thanh gốc lưu local, không tải nhạc ngoài khi LIVE; nguồn gốc và cách tạo lại ở [AUDIO-ASSETS.md](docs/AUDIO-ASSETS.md). Nhạc và hiệu ứng dừng khi tab mất quyền hoặc mất kết nối máy chủ.

AI vẫn giải thích đầy đủ: thường **45–65 từ mỗi lá**, **35–50 từ tổng kết**. Giới hạn mặc định là **65 từ mỗi lá và 50 từ tổng kết**, chỉnh được trong admin từ **45–70/35–55**. Khi cần rút gọn, ứng dụng dừng ở câu hoàn chỉnh nên đoạn có thể ngắn hơn các khoảng thường gặp này. AI trả lời thẳng câu hỏi, dùng lời nói hằng ngày, mỗi câu một ý và gợi ý cụ thể; tránh diễn đạt mơ hồ, thuật ngữ, lời đệm và lặp lại. Mỗi lá và phần tổng kết được đọc bằng **một utterance trình duyệt hoặc một file TTS cho cả đoạn**, không tạo lần đọc mới theo trang hiển thị. Toàn bộ chữ được giữ trong khung cuộn; khung tự cuộn theo câu đang đọc, không cắt giữa cụm để đáp ứng một số từ cố định. Giọng trình duyệt dùng sự kiện boundary khi môi trường hỗ trợ. Với HTTP TTS không có timing, tiến độ câu chỉ được ước lượng từ thời gian phát và độ dài file; không hứa đồng bộ từng từ. Khi không có giọng hoặc TTS lỗi, chữ tiếp tục cuộn theo thời gian giữ nội dung.

Tab đang sở hữu âm thanh gửi tín hiệu bắt đầu và heartbeat trong lúc chuẩn bị/phát. Backend giữ pha đọc khi tín hiệu còn sống, đợi `audio-done` rồi chuyển sau khoảng **800 ms**; không cắt giọng chỉ vì timer ước lượng đã hết, cũng không để im lặng chờ đủ thời lượng mẫu sau khi đã đọc xong. Thời lượng trong admin vẫn dùng cho chế độ chữ và đường dự phòng. Mất nguồn âm thanh, lỗi hoặc hết giới hạn chờ sẽ trả về timer; heartbeat có hạn cứng để tránh treo sân khấu.

**Tạm dừng/tiếp tục trong cùng tab** giữ player và vị trí đang phát khi trình duyệt hỗ trợ. Nếu giọng hệ thống không thể tiếp tục hoặc im lặng sau resume, ứng dụng đợi tối đa 2,5 giây rồi đọc lại từ đầu câu hiện tại một lần để không bỏ sót chữ. Giọng không bắt đầu hoặc lần khôi phục vẫn treo sẽ chuyển sang chữ sau giới hạn 10 giây, không lặp thử vô hạn. Bỏ qua, đọc lại hoặc chuyển lượt loại tác vụ cũ theo `readingId`, bước và generation; đọc lại là thao tác bắt đầu lại cả đoạn hiện tại. Refresh hoặc restart không có cam kết giữ được vị trí của player native, nhưng vẫn giữ ba lá và lời giải đã chốt. Cấu hình mới không thay các tham số nội dung của lượt đã chốt.

Với **OBS**: tạo Browser Source, URL `http://127.0.0.1:3210/overlay?mode=live`, Width **1080**, Height **1920**. Chọn một đường thu âm phù hợp: âm Browser Source hoặc âm desktop mà overlay phát; kiểm tra meter để không thu trùng cùng một nguồn. Tránh bật cả tab Chrome phát tiếng và một Browser Source khác cùng đọc.

Với **TikTok LIVE Studio**: nếu phiên bản hiện tại có nguồn Link/Browser tương ứng, thêm URL overlay với tỷ lệ dọc. Nếu không có, mở overlay bằng Chrome/Edge rồi dùng **Window Capture**. Quyền tự phát âm thanh và giọng Việt phụ thuộc môi trường phát thực tế; phải thử ở đúng nguồn sẽ lên LIVE. Overlay `?guides` chỉ dành cho kiểm tra vùng an toàn, bỏ tham số trước phát.

## AI tùy chọn

Trong **Nội dung & âm thanh**, nguồn lời giải phân biệt **Đang tạo lời giải AI…**, **AI cá nhân hóa** và **Dữ liệu biên soạn / fallback**. Dòng nhắc nơi lưu key là hướng dẫn, không phải lỗi. Nếu AI thất bại, thông báo bên dưới ghi nhóm nguyên nhân cụ thể.

Bật AI hoặc sửa key/model chỉ áp dụng cho lượt mới. Muốn thử lại khi còn lượt cũ đang tạm dừng, hãy hoàn tất hoặc **Bỏ qua lượt hiện tại**, rồi **Chạy một lượt demo**. Nút chạy demo không thay lời giải của lượt đang tồn tại.

Không bật AI vẫn có đầy đủ lời giải tự biên soạn theo ba lá, vị trí, chiều và chủ đề. Bật AI sau khi cấu hình **chỉ tại `backend/.env`**:

```dotenv
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=your-key-here
AI_MODEL=provider-supported-model-name
AI_JSON_MODE=true
```

Adapter gọi `POST {AI_BASE_URL}/chat/completions`, dùng Bearer key và `response_format: {type: "json_object"}` mặc định. Chọn model đang được dịch vụ của bạn hỗ trợ, không có model khóa cứng. Nếu dịch vụ không nhận `response_format`, đặt `AI_JSON_MODE=false`; kết quả vẫn phải là JSON đúng cấu trúc. Bật **Dùng AI cá nhân hóa** ở admin sau khi restart backend.

AI chỉ diễn giải ba lá server đã lưu, không chọn lại bài. Kết quả được kiểm tra `cardId`, vị trí, chiều và độ dài; lỗi/timeout dùng fallback của đúng ba lá. Bình luận được gửi như dữ liệu, không phải chỉ dẫn có quyền đổi prompt/gọi công cụ. Mỗi lá giải thích đầy đủ ý nghĩa theo chiều và chủ đề, liên hệ câu hỏi rồi đưa ra gợi ý cụ thể; tổng kết kết nối cả ba lá. Giới hạn mặc định là 65 từ mỗi lá và 50 từ tổng kết, chỉnh được trong khoảng 45–70/35–55; không dùng bài để khẳng định tương lai hoặc thay tư vấn chuyên môn.

Key không nằm trong bundle, snapshot hay file xuất cấu hình. Không đặt key trong URL, tên model, câu hỏi hoặc asset. Kết nối dịch vụ AI có thể gửi câu hỏi người xem đến nhà cung cấp bạn chọn; hãy vận hành theo cách phù hợp với thông báo của buổi LIVE.

### Hỏi đáp sau trải bài

Khi **Dùng AI cá nhân hóa** và **Cho phép hỏi tiếp sau tổng kết** được bật, backend có cấu hình AI, lượt xem cá nhân giữ đúng người vừa xem để hỏi thêm sau tổng kết. Lượt chung từ tim không mở hỏi đáp. Để gửi mỗi câu hỏi, dùng hai bình luận riêng:

1. Gửi bình luận chỉ có **`!hoi`**. Màn hình báo đang chờ câu hỏi của bạn.
2. Ở bình luận tiếp theo, viết nội dung câu hỏi, ví dụ: **Tôi nên bắt đầu cuộc trò chuyện với người ấy thế nào?**

Lệnh `!hoi` chỉ mở trạng thái chờ, chưa gọi AI hoặc dùng suất câu hỏi. Bình luận câu hỏi tiếp theo phải đến từ đúng tài khoản vừa xem và trước khi hết thời gian hỏi đáp. Muốn hỏi câu khác, lặp lại hai bước trên.

- Chỉ cùng **ID tài khoản** vừa xem được hỏi; trùng nickname không đủ. Nhận tối đa **3 câu khác nhau**, mỗi câu 8–500 ký tự và không chứa liên kết. Câu gửi lặp không chiếm thêm suất.
- AI dùng đúng ba lá, chiều, vị trí, lời giải và các câu đã trả lời của người đó; không rút thêm bài. Câu trả lời hướng tới 40–70 từ, rõ ràng, đi thẳng vào câu hỏi. Overlay giữ ba lá cũ và đọc câu trả lời hiện tại bằng nguồn âm thanh đang chọn.
- Thời gian bắt đầu từ lúc mở hỏi đáp, mặc định **120 giây**. Trong **Nội dung & âm thanh → Hỏi đáp sau trải bài**, `followUpEnabled` bật/tắt chức năng và `followUpWindowSec` chỉnh từ **30 đến 120 giây**. Cấu hình mới áp dụng cho lượt tiếp theo. Đồng hồ tiếp tục chạy khi tạm dừng; đến hạn sẽ kết thúc hỏi đáp.
- Admin có thể nhập giúp câu hỏi của người đang xem, theo dõi ba ô trạng thái và bấm **Kết thúc hỏi đáp sớm**, kể cả khi đang tạm dừng. Đủ ba câu đã trả lời hoặc hết thời gian thì chuyển sang hoàn tất, rồi tiếp tục hàng chờ theo chế độ đang dùng.
- Nếu AI lỗi, hiển thị lỗi và cho thử lại chính câu đó sau ít nhất 5 giây, tối đa **ba lần thử tính cả lần đầu**. Thử lại không dùng thêm suất câu hỏi và vẫn chịu hạn thời gian ban đầu; không tạo câu trả lời giả thay AI. Hỏi đáp không tiêu thụ thêm quà hoặc hoàn lại credit đã dùng.

### Gemini

Backend hỗ trợ endpoint Gemini tương thích OpenAI. Với Gemini, cấu hình riêng trong `backend/.env` (thay placeholder bằng key của bạn):

```dotenv
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_API_KEY=your-gemini-key-here
AI_MODEL=gemini-3.5-flash-lite
AI_JSON_MODE=true
```

Các lần kiểm tra Gemini thật trước được ghi tại [docs/QA.md](docs/QA.md). Model vẫn đổi được; không coi tên trong ví dụ là cam kết hỗ trợ mãi. Backend dùng mức reasoning thấp cho endpoint Gemini để ưu tiên thời gian đáp ứng. Kiểm tra bằng `node --import tsx scripts/check-ai.ts`: script dùng dữ liệu DEMO trong bộ nhớ, chỉ in model/ID lá/số từ và không in key. Khởi động lại backend sau khi sửa `.env`, bật AI trong admin và chọn model tương ứng cho lượt tiếp theo.

Sân khấu đợi AI có giới hạn trước khi đọc lá đầu; timeout vẫn dùng đúng bộ ba đã chốt. Nội dung AI hơi dài được rút gọn theo giới hạn hiển thị và lời đọc dùng cùng văn bản sau rút gọn.

## TTS HTTP tùy chọn

`TTS_URL` là endpoint riêng do bạn chuẩn bị hoặc adapter trước một dịch vụ TTS. Project không giả định mọi nhà cung cấp có cùng API. Backend gửi:

```json
{"text":"Văn bản đang đọc","voice":"voice-id","speed":0.95,"format":"mp3","readingId":"reading-id"}
```

Endpoint cần trả trực tiếp bytes với `Content-Type: audio/mpeg`, `audio/wav`, `audio/ogg` hoặc `audio/webm`, tối đa 15 MB. Không trả JSON chứa URL. `TTS_API_KEY`, nếu có, được gửi bằng `Authorization: Bearer ...`. Backend lưu file tại `data/audio/` và phát URL local; file này chứa lời đọc của người xem. Dịch vụ trả schema khác cần sửa adapter trong `server/providers.ts`. Không có dịch vụ/key vẫn dùng giọng hệ thống nếu khả dụng hoặc chế độ chữ.

Audio client trong app gọi `POST /api/tts?mode=live` với `readingId`, `phase` và `generation`, kèm `X-Audio-Client` của tab đang sở hữu âm thanh. Backend kiểm tra lượt/bước/quyền loa, tự lấy **toàn bộ lời đọc của pha hiện tại** và trả `{url,text}`. Một file được tổng hợp và dùng cache cho cả đoạn; không đợi tải file kế tiếp ở giữa câu. Client không được gửi văn bản tùy ý để đổi lời đọc. Hợp đồng này là API local của ứng dụng, khác với `TTS_URL` bên ngoài ở trên.

## Giao diện và tài sản

Trong **Sân khấu & giao diện**, đổi tên tiệm, hướng dẫn, màu, cỡ chữ, safe margins, giảm chuyển động và mức hiệu ứng 30/60 FPS. Safe guides chỉ hiện khi bật kiểm tra; stage luôn 1080 × 1920 rồi scale theo tỷ lệ.

Đặt tài sản riêng trong `public/custom/`, nhập URL như `/custom/nhan-vat.png`, `/custom/nen.webp`, `/custom/lung-bai.svg`. Nhân vật/nền hỗ trợ ảnh hoặc video MP4/WebM theo giao diện; video nên ngắn, nhẹ và tắt tiếng. Với từng lá, nhập JSON `cardId → đường dẫn`; danh sách ID và nội dung nằm ở `shared/cards.ts`. Dùng asset có quyền sử dụng. Ưu tiên file local để khi phát không phụ thuộc CDN; chạy lại `npm run build` sau khi thêm/thay file nếu dùng bản production.

Nhân vật PNG được tạo riêng bằng công cụ image_gen. Bộ bài mặc định là **đủ 78 ảnh quét Rider–Waite–Smith (Pam-A)** lưu local tại `public/assets/rws/`, được đối chiếu theo từng cardId; gồm 22 lá Ẩn chính và 56 lá Ẩn phụ, Strength VIII và Justice XI. Ảnh giữ cả lá, đường viền và tên in, chỉ xoay khi rút chiều ngược. Nguồn, tác giả, trạng thái sử dụng và manifest từng ảnh ở [docs/RWS-SOURCES.md](docs/RWS-SOURCES.md). SVG biểu tượng đời đầu vẫn được giữ để tham khảo và không còn là hình mặc định. Xem thêm [ASSETS.md](ASSETS.md) và [prompt nhân vật](docs/CHARACTER-PROMPT.md). Dữ liệu demo không lấy danh tính từ ảnh tham chiếu.

## Lưu trạng thái và phục hồi

`data/tarot.sqlite` dùng SQLite WAL, lưu cấu hình, queue, credit, dấu sự kiện/combo, tim, lượt và ba lá đã chốt. Refresh/reconnect frontend chỉ đọc trạng thái. Sau restart backend, lượt đang dở được phục hồi ở trạng thái **tạm dừng**, cần admin tiếp tục; lượt hoàn tất không tự đọc lại. Tự động/chạy thủ công chỉnh được ở admin. Cấu hình nội dung, quy tắc và nhịp đọc của lượt đã chốt được giữ riêng; thay màu/cỡ chữ áp dụng khi lưu.

**Xuất cấu hình** chỉ xuất các trường công khai, không kèm secret hoặc dữ liệu người xem. Để sao lưu cả phiên, dừng backend sạch rồi sao chép `data/` và file asset riêng; không xóa SQLite để xử lý lỗi thông thường. Cấu hình URL TikFinity ở `data/connection.json`. File `backend/.env` được giữ riêng và không đưa vào bản chia sẻ. Lịch sử phiên được lưu tại SQLite; API local `/api/history?mode=live` và `/api/history/{id}` phục vụ đối soát.

## Checklist trước khi phát

- [ ] Mở đúng `/admin`, chọn LIVE; kiểm tra chế độ tham gia, mức xu, lệnh và mốc tim hiển thị thống nhất.
- [ ] TikFinity nối và có thời điểm nhận sự kiện LIVE mới; comment hợp lệ tạo đúng tài khoản/câu hỏi.
- [ ] Quà đơn và combo thực tế có đủ metadata; dãy combo không cộng lặp, credit thiếu dữ liệu được kiểm tra.
- [ ] Overlay 1080 × 1920 không bị UI TikTok che phần tên, câu hỏi, lời giải hoặc bài; tắt safe guides.
- [ ] Chạy một lượt đầy đủ trong đúng Browser Source/Window Capture, kiểm tra chữ Việt và các chiều bài.
- [ ] Đọc trọn đoạn mỗi lá/tổng kết, không ngắt giữa cụm; khung chữ cuộn hết nội dung và chuyển sau khi giọng kết thúc.
- [ ] Bật âm thanh tại đúng một nguồn LIVE; tắt nguồn DEMO và tab thử, kiểm tra không thu hai lần.
- [ ] Thử pause/resume/skip, refresh overlay và mất/nối socket; lượt không đổi bài hoặc phát tiếng cũ.
- [ ] Nếu dùng AI/TTS, thử dịch vụ thật và lỗi/timeout; fallback vẫn kết thúc lượt.
- [ ] Bắt đầu đúng phiên/phòng và baseline tim; xác nhận thao tác đối soát credit còn tồn.

## Kiểm tra và giới hạn xác minh

Kiểm tra riêng cơ chế tự cài trên Windows (không tải mạng):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/TEST-WINDOWS-SETUP.ps1
```

Kiểm tra ứng dụng:

```powershell
npm run typecheck
npm test
npm run build
```

Kết quả bàn giao, ảnh trạng thái chờ/trải/đọc và các giới hạn được ghi ở [docs/QA.md](docs/QA.md). Fixture mô phỏng không thay thế kiểm tra payload LIVE thật. Đã có thể kiểm tra HTTP local trong môi trường Windows của phiên làm việc này; điều đó không chứng minh TikFinity hoặc âm thanh của máy phát khác. Nếu Codex chạy từ xa, `localhost` của Codex là máy từ xa và **không thể tự xác minh localhost/TikFinity trên máy Windows của bạn**. Chưa có LIVE/API key thì hoàn thiện DEMO và ghi rõ phần cần bạn xác nhận, không tạo trạng thái LIVE giả.

## Cấu trúc mã

```text
src/main.tsx         React: admin, overlay, demo và sân khấu
src/audio.ts         nguồn âm thanh duy nhất, giọng hệ thống/TTS và đồng bộ câu
src/speech-playback.ts player đọc liên tục, pause/resume và loại callback cũ
src/session.ts       HTTP/WebSocket snapshot và thao tác theo phiên
src/CreditLedger.tsx đối soát, xác nhận, ghép và hoàn credit
src/FollowUpPanel.tsx hỏi đáp sau trải bài và thao tác điều hành
server/engine.ts     queue, credit, tim, state machine, action và phục hồi
server/chat-guard.ts chống lặp chat thiếu msgId và câu hỏi vừa hoàn tất
server/tikfinity.ts  adapter WebSocket và chuẩn hóa envelope
server/providers.ts  fallback, AI Chat Completions, TTS HTTP
server/store.ts      SQLite snapshot và phiên lưu trữ
shared/              kiểu dữ liệu, 78 lá và vị trí câu cho phụ đề
public/assets/       nhân vật, bộ RWS 78 lá, font và avatar local
public/custom/       tài sản riêng do người vận hành bổ sung
tests/               kiểm thử adapter, engine, deck và provider
docs/                giao thức, quyết định và kết quả QA
```

Các quyết định thiết kế và kỹ thuật ở [docs/DECISIONS.md](docs/DECISIONS.md).
