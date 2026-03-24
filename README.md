# CrotMail

Disposable email service berbasis Cloudflare Workers dengan mode ringan tanpa database. Inbox aktif ditahan di memori Worker, lalu frontend menyimpan cache email ke `localStorage` agar UI terasa instan dan instalasi jauh lebih cepat.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/imnoob59/crotmail?style=social)](https://github.com/imnoob59/crotmail/stargazers)

- Website: https://crotmail.app
- Repository: https://github.com/imnoob59/crotmail

## Quick Start

### Prasyarat

- Node.js 18+
- Akun Cloudflare
- Domain yang aktif di Cloudflare untuk Email Routing

### Instalasi Cepat

1. Install dependency:

```bash
npm install
```

2. Login ke Wrangler:

```bash
npx wrangler login
```

3. Salin template config:

```bash
cp wrangler.clean.toml wrangler.toml
```

4. Isi variable minimum di `wrangler.toml`:

```toml
[vars]
MAIL_DOMAINS = "mail1.example.com,mail2.example.com"
EXPIRE_MINUTES = "43200"
MESSAGE_RETENTION_DAYS = "1"
```

`ACCESS_KEY` sekarang opsional. Kalau ingin membatasi pembuatan inbox dari UI/API, simpan sebagai secret:

```bash
npx wrangler secret put ACCESS_KEY
```

5. Deploy:

```bash
npm run deploy
```

6. Verifikasi domain endpoint:

Tanpa access key:

```bash
curl https://your-domain.com/api/domains
```

Dengan access key:

```bash
curl -H "X-Access-Key: ACCESS_KEY_ANDA" https://your-domain.com/api/domains
```

Kalau domain list sudah keluar, lanjut setup Email Routing ke Worker supaya inbox bisa menerima email masuk.

## Yang Berubah di Mode Ringan

- Tidak perlu D1
- Tidak perlu KV
- Tidak perlu migration schema
- Session inbox tetap disimpan di browser via `localStorage`
- Email yang sudah diambil UI akan dicache lokal agar muncul lebih cepat saat reload

## Tradeoff Penting

Mode ini memang lebih cepat diinstal, tapi ada konsekuensi:

- Mailbox aktif disimpan di memori Worker, bukan storage durabel
- Saat Worker restart, redeploy, atau pindah isolate, inbox aktif bisa hilang
- `localStorage` hanya menyimpan cache browser, bukan sumber data utama saat email baru masuk

Kalau Anda butuh inbox yang lebih tahan restart atau histori yang lebih konsisten, sebaiknya pakai mode dengan storage persisten.

## Highlight Fitur

- Inbox instan dengan random address atau custom username
- Dukungan multi-domain dari `MAIL_DOMAINS`
- Resume inbox via kode unik 8 karakter
- Auto refresh inbox di UI
- Cache email lokal di browser
- UI modern dengan Vue 3 + Tailwind
- `ACCESS_KEY` opsional untuk proteksi endpoint sensitif

## Arsitektur

### Backend

- Cloudflare Workers
- In-memory mailbox store
- JWT authentication (`full` dan `limited`)
- Cloudflare Email Worker handler untuk menangkap email masuk

### Frontend

- Vue 3
- Vite
- Tailwind CSS
- Pinia
- `localStorage` untuk session dan cache inbox

## Endpoint Penting

- `GET /api/domains` daftar domain inbox
- `POST /api/generate` buat inbox random
- `POST /api/custom` buat inbox custom
- `POST /api/resume` buka inbox via resume code
- `GET /api/messages` ambil daftar email inbox aktif
- `GET /api/messages/{id}` detail email
- `DELETE /api/messages/{id}` hapus email
- `DELETE /api/accounts/{id}` hapus inbox milik session aktif

Dokumentasi API lengkap ada di [API.md](./API.md).

## Konfigurasi Environment

| Variable | Required | Keterangan |
|---|---|---|
| `MAIL_DOMAINS` | Yes | Daftar domain inbox, pisahkan koma |
| `EXPIRE_MINUTES` | No | Umur inbox default dalam menit, default `43200` |
| `MESSAGE_RETENTION_DAYS` | No | Retensi pesan in-memory sebelum cleanup, default `1` |
| `ACCESS_KEY` | No | Jika diisi, endpoint sensitif butuh `X-Access-Key` |
| `JWT_SECRET` | No | Secret JWT custom. Jika kosong akan fallback ke `ACCESS_KEY` atau secret bawaan mode ringan |

## Deploy Cloudflare

### Opsi A. Dashboard / GitHub

1. Connect repository ke Cloudflare Workers and Pages.
2. Build command: `npm run build`.
3. Tambahkan binding assets sesuai template.
4. Isi `MAIL_DOMAINS`, `EXPIRE_MINUTES`, `MESSAGE_RETENTION_DAYS`.
5. Tambahkan `ACCESS_KEY` jika ingin mode privat.
6. Deploy.

### Opsi B. Wrangler CLI

1. `npm install`
2. `npx wrangler login`
3. `cp wrangler.clean.toml wrangler.toml`
4. Isi variable di `wrangler.toml`
5. `npm run deploy`

## Setup Email Routing

Untuk tiap domain inbox:

1. Pastikan domain dikelola di Cloudflare.
2. Buka `Email` -> `Email Routing`.
3. Tambahkan rule `*@domain-kamu.com`.
4. Arahkan action ke Worker `crot-mail`.

Setelah itu email yang masuk ke domain tersebut akan ditangkap oleh handler email Worker dan tampil di UI saat inbox aktif dipolling.
