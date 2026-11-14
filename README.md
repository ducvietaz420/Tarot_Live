# Tiệm Tarot LIVE

Ứng dụng local cho Windows: sân khấu tarot dọc, hàng chờ theo ID tài khoản, ba lá cố định cho mỗi lượt, nội dung tiếng Việt và kết nối sự kiện TikFinity tại backend. DEMO chạy đầy đủ khi chưa LIVE và chưa có API key. Nội dung mang tính giải trí và tự chiêm nghiệm.

Ảnh tham chiếu bố cục đầy đủ không xuất hiện trong dữ liệu được cung cấp ở lần dựng đầu. Giao diện được dựng theo bố cục và bảng màu trong yêu cầu bằng nhân vật tạo riêng, nền huyền học và bộ bài Rider–Waite–Smith; chưa thể xác nhận khớp từng chi tiết của ảnh gốc.

## Chạy trên Windows

Cài **Node.js 24 trở lên**. SQLite tích hợp trong Node, không cần cài dịch vụ database, Docker hoặc hosting.

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

Sau lần `npm install`, có thể bấm đúp **`START.cmd`**. Script kiểm tra Node, build, chạy backend ẩn rồi mở admin. **Giữ cửa sổ launcher mở trong lúc sử dụng**: `START.cmd` bật `-KeepAlive` để giữ tiến trình chạy ổn định. Nếu Tiệm Tarot đã chạy ở cổng đó, script dùng lại phiên, mở admin rồi thoát. Script không dừng tiến trình khác.

Log khởi động và PID ở `data/startup.*.log`, `data/launcher.pid`. Khi muốn dừng bản launcher, xác định đúng PID backend trong Task Manager; cửa sổ launcher đang chờ sẽ kết thúc khi backend dừng. Với terminal `npm run dev`/`npm start`, dùng `Ctrl+C`. Cần khởi động lại backend sau khi sửa biến môi trường. Có thể chạy `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/START-WINDOWS.ps1 -NoBrowser -KeepAlive` để giữ launcher mà không tự mở cửa sổ trình duyệt; `-NoBrowser` và `-KeepAlive` là hai tùy chọn độc lập.

Ứng dụng chỉ bind `127.0.0.1`; không được truy cập từ điện thoại hoặc máy khác bằng IP LAN mặc định. Không mở cổng router. Muốn đổi cổng, sao chép `backend/.env.example` thành `backend/.env` và sửa `PORT`; cập nhật URL nguồn phát tương ứng. File `.env.example` ở gốc chỉ dẫn đến cấu hình backend, không được server nạp.

## Thử ngay khi chưa LIVE

1. Mở `/demo`, chọn **Chạy một lượt demo**. Theo dõi chốt yêu cầu → xào → chia → ba lá → tổng kết → hoàn tất.
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

1. Trong **Nội dung & âm thanh**, chọn giọng hệ thống/trình duyệt hoặc TTS HTTP, tốc độ và âm lượng; nhạc mặc định tắt.
2. Bấm **Kiểm tra âm thanh** trên trình duyệt sẽ dùng để phát. Danh sách giọng `vi-*` phản ánh khả năng thật của môi trường đó; Windows/Chrome có giọng Việt không có nghĩa Browser Source của OBS cũng có.
3. Tắt tiếng tab kiểm tra, rồi mở đúng overlay phát và bấm **Bật âm thanh**. Nếu dùng OBS Browser Source, dùng thao tác **Interact** của nguồn để bấm nút khi cần.
4. Kiểm tra cả lời đọc và âm xào/lật. Theo dõi báo lỗi ở admin. Không có giọng hoặc TTS lỗi vẫn chạy bằng chữ và thời gian giữ nội dung.

Lời giải đầy đủ của mỗi lá có 45–70 từ theo cấu hình. Mỗi lá và phần tổng kết được đọc bằng **một utterance trình duyệt hoặc một file TTS cho cả đoạn**, không tạo lần đọc mới theo trang hiển thị. Toàn bộ chữ được giữ trong khung cuộn; khung tự cuộn theo câu đang đọc, không cắt giữa cụm để đáp ứng một số từ cố định. Giọng trình duyệt dùng sự kiện boundary khi môi trường hỗ trợ. Với HTTP TTS không có timing, tiến độ câu chỉ được ước lượng từ thời gian phát và độ dài file; không hứa đồng bộ từng từ. Khi không có giọng hoặc TTS lỗi, chữ tiếp tục cuộn theo thời gian giữ nội dung.

Tab đang sở hữu âm thanh gửi tín hiệu bắt đầu và heartbeat trong lúc chuẩn bị/phát. Backend giữ pha đọc khi tín hiệu còn sống, đợi `audio-done` rồi chuyển sau khoảng **800 ms**; không cắt giọng chỉ vì timer ước lượng đã hết, cũng không để im lặng chờ đủ thời lượng mẫu sau khi đã đọc xong. Thời lượng trong admin vẫn dùng cho chế độ chữ và đường dự phòng. Mất nguồn âm thanh, lỗi hoặc hết giới hạn chờ sẽ trả về timer; heartbeat có hạn cứng để tránh treo sân khấu.

**Tạm dừng/tiếp tục trong cùng tab** giữ player và vị trí đang phát khi trình duyệt hỗ trợ. Nếu giọng hệ thống không thể tiếp tục hoặc im lặng sau resume, ứng dụng đợi tối đa 2,5 giây rồi đọc lại từ đầu câu hiện tại một lần để không bỏ sót chữ. Giọng không bắt đầu hoặc lần khôi phục vẫn treo sẽ chuyển sang chữ sau giới hạn 10 giây, không lặp thử vô hạn. Bỏ qua, đọc lại hoặc chuyển lượt loại tác vụ cũ theo `readingId`, bước và generation; đọc lại là thao tác bắt đầu lại cả đoạn hiện tại. Refresh hoặc restart không có cam kết giữ được vị trí của player native, nhưng vẫn giữ ba lá và lời giải đã chốt. Cấu hình mới không thay các tham số nội dung của lượt đã chốt.

Với **OBS**: tạo Browser Source, URL `http://127.0.0.1:3210/overlay?mode=live`, Width **1080**, Height **1920**. Chọn một đường thu âm phù hợp: âm Browser Source hoặc âm desktop mà overlay phát; kiểm tra meter để không thu trùng cùng một nguồn. Tránh bật cả tab Chrome phát tiếng và một Browser Source khác cùng đọc.

Với **TikTok LIVE Studio**: nếu phiên bản hiện tại có nguồn Link/Browser tương ứng, thêm URL overlay với tỷ lệ dọc. Nếu không có, mở overlay bằng Chrome/Edge rồi dùng **Window Capture**. Quyền tự phát âm thanh và giọng Việt phụ thuộc môi trường phát thực tế; phải thử ở đúng nguồn sẽ lên LIVE. Overlay `?guides` chỉ dành cho kiểm tra vùng an toàn, bỏ tham số trước phát.

## AI tùy chọn

Không bật AI vẫn có đầy đủ lời giải tự biên soạn theo ba lá, vị trí, chiều và chủ đề. Bật AI sau khi cấu hình **chỉ tại `backend/.env`**:

```dotenv
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=your-key-here
AI_MODEL=provider-supported-model-name
AI_JSON_MODE=true
```

Adapter gọi `POST {AI_BASE_URL}/chat/completions`, dùng Bearer key và `response_format: {type: "json_object"}` mặc định. Chọn model đang được dịch vụ của bạn hỗ trợ, không có model khóa cứng. Nếu dịch vụ không nhận `response_format`, đặt `AI_JSON_MODE=false`; kết quả vẫn phải là JSON đúng cấu trúc. Bật **Dùng AI cá nhân hóa** ở admin sau khi restart backend.

AI chỉ diễn giải ba lá server đã lưu, không chọn lại bài. Kết quả được kiểm tra `cardId`, vị trí, chiều và độ dài; lỗi/timeout dùng fallback của đúng ba lá. Bình luận được gửi như dữ liệu, không phải chỉ dẫn có quyền đổi prompt/gọi công cụ. Mỗi lá 45–70 từ và tổng kết 35–55 từ theo cấu hình; không dùng bài để khẳng định tương lai hoặc thay tư vấn chuyên môn.

Key không nằm trong bundle, snapshot hay file xuất cấu hình. Không đặt key trong URL, tên model, câu hỏi hoặc asset. Kết nối dịch vụ AI có thể gửi câu hỏi người xem đến nhà cung cấp bạn chọn; hãy vận hành theo cách phù hợp với thông báo của buổi LIVE.

### Gemini

Backend hỗ trợ endpoint Gemini tương thích OpenAI. Với Gemini, cấu hình riêng trong `backend/.env` (thay placeholder bằng key của bạn):

```dotenv
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_API_KEY=your-gemini-key-here
AI_MODEL=gemini-3.5-flash-lite
AI_JSON_MODE=true
```

`gemini-3.5-flash-lite` đã được kiểm tra bằng API thật trong lần cập nhật này. Model vẫn đổi được; không coi tên trong ví dụ là cam kết hỗ trợ mãi. Backend dùng mức reasoning thấp cho endpoint Gemini để ưu tiên thời gian đáp ứng. Kiểm tra bằng `node --import tsx scripts/check-ai.ts`: script dùng dữ liệu DEMO trong bộ nhớ, chỉ in model/ID lá/số từ và không in key. Khởi động lại backend sau khi sửa `.env`, bật AI trong admin và chọn model tương ứng cho lượt tiếp theo.

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
server/engine.ts     queue, credit, tim, state machine, action và phục hồi
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
