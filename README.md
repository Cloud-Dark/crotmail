# CrotMail

CrotMail adalah temp mail berbasis Cloudflare Workers dengan mode instalasi cepat (tanpa DB wajib), plus stream realtime untuk email masuk.

## Quick Start

1. Install dependency:

```bash
npm install
```

2. Login Wrangler:

```bash
npx wrangler login
```

3. Copy config:

```bash
cp wrangler.clean.toml wrangler.toml
```

4. Isi variable minimal:

```toml
[vars]
MAIL_DOMAINS = "mail1.example.com,mail2.example.com"
EXPIRE_MINUTES = "43200"
MESSAGE_RETENTION_DAYS = "1"
```

`ACCESS_KEY` opsional:

```bash
npx wrangler secret put ACCESS_KEY
```

5. Deploy:

```bash
npm run deploy
```

## Endpoint Realtime

Endpoint stream:

```text
GET /stream_ready_use?token=xxxx
```

Perilaku:

- Menggunakan SSE (`text/event-stream`)
- Event `ready` saat konek berhasil
- Event `message` saat email baru masuk
- Event `ping` keepalive
- Koneksi stream auto ditutup setelah 1 jam (`event: end`)

## Pengaturan dari UI

Di halaman `/app` sekarang tersedia panel konfigurasi:

- Storage provider:
  - `localStorage` (default)
  - `Supabase`
  - `Cloudflare D1`
- Storage base URL
- Storage API key
- API base (`/api` atau custom domain API)
- Access key untuk header `X-Access-Key`
- Runtime config:
  - `ACCESS_KEY`
  - `MAIL_DOMAINS`
  - `EXPIRE_MINUTES`
  - `MESSAGE_RETENTION_DAYS`
- Tombol:
  - `Simpan UI Config`
  - `Migrate Sekarang`
  - `Apply Runtime Config`

Catatan runtime config:

- Runtime config disimpan di memory Worker (sementara)
- Akan reset jika Worker restart/redeploy

## Storage Provider Notes

### 1) localStorage (default)

- Tanpa setup tambahan
- Cache email ada di browser user

### 2) Supabase

UI akan baca/tulis tabel `crotmail_cache` via Supabase REST.

Contoh struktur tabel minimum:

```sql
create table if not exists public.crotmail_cache (
  address text primary key,
  messages jsonb not null default '[]'::jsonb,
  current_mail jsonb null,
  updated_at timestamptz not null default now()
);
```

### 3) Cloudflare D1

Untuk opsi D1, binding `DB` harus disediakan di Wrangler (opsional, hanya jika dipakai provider D1). Worker akan membuat tabel cache UI otomatis saat endpoint migrasi dipanggil.

## Arsitektur Ringkas

- Inbox aktif dan email masuk utama: in-memory Worker
- Realtime update: SSE `/stream_ready_use`
- Cache UI: provider yang dipilih dari UI
- Cleanup:
  - pesan lama berdasarkan `MESSAGE_RETENTION_DAYS`
  - stream session auto expire 1 jam

## Konfigurasi Environment

| Variable | Required | Keterangan |
|---|---|---|
| `MAIL_DOMAINS` | Yes | Daftar domain inbox |
| `EXPIRE_MINUTES` | No | Umur inbox default |
| `MESSAGE_RETENTION_DAYS` | No | Retensi pesan |
| `ACCESS_KEY` | No | Proteksi endpoint sensitif |
| `JWT_SECRET` | No | Secret JWT custom |

## Penting

- Mode ini fokus kemudahan penggunaan dan instalasi cepat.
- Untuk kebutuhan durability tinggi (data tahan restart/redeploy), gunakan provider cache yang persisten (`Supabase`/`D1`) dan pertimbangkan migrasi arsitektur mailbox utama ke storage persisten penuh.
