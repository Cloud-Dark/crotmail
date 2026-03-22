# Release Checklist

Gunakan checklist ini sebelum membuat release baru.

## 1. Kualitas Kode

- [ ] Build lokal sukses (`npm run build`)
- [ ] CI GitHub Actions status hijau
- [ ] Tidak ada data sensitif yang ikut commit
- [ ] Dokumentasi utama sudah diperbarui

## 2. Dokumentasi

- [ ] `README.md` sesuai fitur terbaru
- [ ] `API.md` sesuai endpoint terbaru
- [ ] `CHANGELOG.md` menuliskan perubahan release

## 3. Infrastruktur Cloudflare

- [ ] Binding D1/KV sudah benar
- [ ] Environment variables sudah valid
- [ ] Mail domains dan Email Routing sudah aktif

## 4. Verifikasi Fungsional

- [ ] Generate inbox random berhasil
- [ ] Custom inbox berhasil
- [ ] Resume code flow berhasil
- [ ] Delete inbox (user mode dan admin mode) berhasil
- [ ] Incoming email test muncul di inbox

## 5. Publikasi

- [ ] Buat tag release
- [ ] Tulis release notes singkat
- [ ] Verifikasi build production terbaru aktif
