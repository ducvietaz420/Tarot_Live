# Âm thanh riêng của Tiệm Tarot

Ba file WAV trong `public/assets/audio/` được tổng hợp và sáng tác riêng bằng mã nguồn của project. Không dùng bản thu, sample, bài hát, dịch vụ tạo nhạc hoặc tài sản tải ngoài.

- `card-shuffle.wav`: 2,4 giây, nhiều lớp tiếng giấy lướt, các nhịp riffle và tiếng đặt bộ bài; mono 32 kHz PCM 16-bit.
- `card-deal.wav`: 0,38 giây, tiếng lướt/đặt một lá bài; mono 32 kHz PCM 16-bit.
- `tarot-ambient.wav`: vòng nhạc 64 giây, stereo 32 kHz PCM 16-bit. Hòa âm Dm9/Bbmaj7/Gm9/Am7 và Cadd9, pad ấm chuyển chậm, giai điệu chuông/gảy thưa, không trống. Các nốt và đuôi vang được trộn vòng để tiếp nối ở điểm loop.

Chạy lại để tạo đúng cùng các file và cập nhật số đo/hash:

```powershell
node scripts/generate-audio-assets.mjs
```

`manifest.json` lưu thời lượng, định dạng, peak/RMS, độ chênh mẫu tại điểm nối và SHA-256. Bộ tạo kiểm tra tín hiệu hữu hạn, không clip, không im lặng; điểm nối nhạc không được đột ngột hơn các bước sóng bên trong file. Các số đo này không thay cho kiểm tra loa hoặc meter tại nguồn OBS/LIVE Studio thực tế.
