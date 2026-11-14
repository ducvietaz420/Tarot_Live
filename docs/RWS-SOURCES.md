# Nguồn bộ bài Rider–Waite–Smith

Bộ bài mặc định gồm đủ 78 ảnh quét nguyên bản “Pam-A” của Rider–Waite–Smith, tác giả hình vẽ Pamela Colman Smith. Bộ ảnh được tải từ [nhóm 78 file đồng bộ trên Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:Rider-Waite-Smith_tarot_deck_(TaionWC)). Metadata các file ghi năm 1910 và trạng thái Public domain; ví dụ [The Fool](https://commons.wikimedia.org/wiki/File:RWS_Tarot_00_Fool.jpg) và [Ace of Cups](https://commons.wikimedia.org/wiki/File:Cups01.jpg). Không dùng một bản tô màu lại thương mại hiện đại.

Ảnh được lưu local tại `public/assets/rws/` bằng bản hiển thị chính thức rộng 500 px do Wikimedia cung cấp, gồm cả đường viền và tên in trên lá. Đây là ảnh thu nhỏ toàn lá của cùng bản quét Pam-A; project không tự cắt, vẽ lại hoặc đổi màu ảnh. Giao diện xoay ảnh khi rút chiều ngược; file nguồn luôn là chiều xuôi. Việc phát LIVE không phải tải ảnh từ Wikimedia.

## Đối chiếu từng lá

[manifest.json](../public/assets/rws/manifest.json) ghi cho từng cardId: tên Việt/Anh, tên file Commons, trang nguồn, URL tải bản 500 px và URL bản gốc, tác giả, trạng thái giấy phép, kích thước nguồn/bản tải, SHA-1 nguồn và SHA-256 local. Hash nguồn và hash ảnh thu nhỏ được ghi riêng, không coi chúng là cùng một file. Script kiểm tra nhãn mô tả nguồn khớp tên tiếng Anh của dữ liệu trước khi chấp nhận ảnh.

- 22 lá Ẩn chính; **Strength là VIII**, **Justice là XI**, đúng thứ tự Rider–Waite–Smith.
- 56 lá Ẩn phụ: Wands/Gậy, Cups/Cốc, Swords/Kiếm, Pentacles/Tiền, mỗi bộ 14 lá.
- Các ID hạng 11/12/13/14 tương ứng Page/Tiểu Đồng, Knight/Kỵ Sĩ, Queen/Nữ Hoàng, King/Vua.
- Các SVG biểu tượng đời đầu vẫn nằm trong `public/assets/cards/` để tham khảo; chúng không còn là hình mặc định.

## Tái tải và kiểm tra

```powershell
node --import tsx scripts/download-rws.mjs
npx tsx --test tests/deck.test.ts tests/deck-artwork.test.ts
```

Script chỉ tải vào thư mục ảnh RWS, tái sử dụng file khớp manifest, tải tuần tự có nhịp nghỉ và tôn trọng thông báo giới hạn của máy chủ. Tất cả 78 ảnh được kiểm tra định dạng/kích thước/hash; manifest chỉ được ghi sau khi cả bộ hoàn tất. Bộ dữ liệu `shared/cards.ts` giữ nguyên ID và nội dung, chỉ thay đường dẫn artwork. Bản 500 px giúp phục vụ sân khấu local nhẹ hơn; những ảnh gốc đã tải khi thử nguồn được giữ trong thư mục `tmp/` bị loại khỏi gói chia sẻ.

Thông tin Public domain được ghi lại theo từng trang nguồn Wikimedia Commons; [Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/) giải thích nhãn này. Tên tác giả và nguồn vẫn được giữ đầy đủ trong project.
