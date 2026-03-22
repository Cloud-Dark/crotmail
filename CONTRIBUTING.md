# Contributing to CrotMail

Terima kasih sudah tertarik berkontribusi.

## Alur Kontribusi

1. Fork repository.
2. Buat branch baru dari `main`.
3. Lakukan perubahan kecil dan terfokus.
4. Pastikan build berjalan lokal.
5. Buat Pull Request dengan deskripsi yang jelas.

## Setup Lokal

```bash
npm install
npm run dev
```

Untuk validasi build:

```bash
npm run build
```

## Standar Perubahan

- Hindari perubahan besar yang mencampur banyak topik.
- Pertahankan kompatibilitas API kecuali ada alasan kuat dan dokumentasi jelas.
- Tambahkan atau update dokumentasi saat behavior berubah.
- Jangan commit data sensitif, key, atau domain privat.

## Commit Message

Gunakan format sederhana berikut agar riwayat commit rapi:

- `feat: ...` untuk fitur baru
- `fix: ...` untuk perbaikan bug
- `docs: ...` untuk dokumentasi
- `refactor: ...` untuk perubahan struktur kode tanpa mengubah behavior

## Pull Request Checklist

Sebelum membuka PR, pastikan:

- Build sukses (`npm run build`)
- Tidak ada data sensitif di file
- README/API docs sudah diperbarui jika perlu
- Perubahan sudah diuji minimal pada flow utama (create inbox, refresh inbox, delete inbox)

## Scope Prioritas

Kontribusi yang sangat membantu:

- Stabilitas API dan email ingestion
- UX web app dan extension
- Dokumentasi deploy dan operasional Cloudflare
- Monitoring, observability, dan reliability
