# CrotMail API Documentation

## Base

- Default API base: `/api`
- Realtime stream: `/stream_ready_use`

## Auth

- `X-Access-Key` (opsional, jika `ACCESS_KEY` aktif)
- `Authorization: Bearer <token>` untuk endpoint inbox

## Core Endpoints

- `GET /api/domains`
- `POST /api/generate`
- `POST /api/custom`
- `POST /api/token`
- `POST /api/resume`
- `GET /api/me`
- `PATCH /api/me/extend`
- `DELETE /api/accounts/{id}`
- `POST /api/admin/delete-account`
- `GET /api/messages`
- `GET /api/messages/{id}`
- `PATCH /api/messages/{id}`
- `DELETE /api/messages/{id}`
- `GET /api/sources/{id}`
- `GET /api/attachments/{id}`

## Realtime Stream

`GET /stream_ready_use?token=<jwt>`

Response:

- Content-Type: `text/event-stream`
- Event:
  - `ready`
  - `message`
  - `ping`
  - `end`

Koneksi stream otomatis ditutup setelah 1 jam.

## Runtime Config API

- `GET /api/runtime-config` (butuh full session token)
- `PATCH /api/runtime-config` (butuh full session token)

Body `PATCH`:

```json
{
  "ACCESS_KEY": "optional",
  "MAIL_DOMAINS": "mail1.com,mail2.com",
  "EXPIRE_MINUTES": 43200,
  "MESSAGE_RETENTION_DAYS": 1
}
```

Catatan: config ini runtime-only (sementara, tidak persisten lintas restart Worker).

## D1 UI Cache API (optional)

Binding `DB` wajib untuk endpoint ini.

- `GET /api/storage/d1/load`
- `POST /api/storage/d1/migrate`

Body migrasi:

```json
{
  "messages": [],
  "currentMail": null
}
```
