# CrotMail v1.0.0

Initial public release of CrotMail as a production-ready disposable email platform built on Cloudflare Workers.

## Highlights

- 30-day inbox lifecycle by default (`EXPIRE_MINUTES=43200`)
- Message retention auto-cleanup (default 1 day)
- Resume access with unique 8-character code
- Auth scopes:
  - `full`: full mailbox management
  - `limited`: read and delete message only
- Admin mailbox deletion by address (`POST /api/admin/delete-account`)
- Public landing page (`/`) and app experience (`/app`)
- Browser extension support for daily tempmail workflow

## Added

- Resume code flow and limited-access mode
- Admin endpoint to delete mailbox by address using `X-Access-Key`
- Modernized web UI and extension tempmail UX
- Public landing page with project and maintainer information
- Documentation suite:
  - `README.md`
  - `API.md`
  - `CONTRIBUTING.md`
  - `SECURITY.md`
  - `CODE_OF_CONDUCT.md`
  - `CHANGELOG.md`
  - `RELEASE_CHECKLIST.md`
- Repository governance and collaboration templates:
  - PR template
  - Bug report and feature request templates
- CI pipeline and dependency automation:
  - GitHub Actions build workflow
  - Dependabot configuration

## Changed

- Default mailbox expiration updated to 30 days
- Message retention set to 1 day by default
- Deployment documentation expanded (GitHub Dashboard and Wrangler CLI)

## Fixed

- SPA fallback behavior for resume route handling (`/r/:code`)
- Extension handling for expired mailbox token with better recovery path

## API Notes

Important endpoints in this release:

- `POST /api/generate`
- `POST /api/custom`
- `POST /api/token`
- `POST /api/resume`
- `DELETE /api/accounts/{id}`
- `POST /api/admin/delete-account`

Full API reference: `API.md`

## Deployment Notes

- Ensure `DB` (D1) and `MAIL_KV` bindings are configured
- Set required env vars:
  - `ACCESS_KEY`
  - `MAIL_DOMAINS`
- Run schema migration before first production use:

```bash
npx wrangler d1 execute <NAMA_DB_D1> --remote --file schema.sql
```

## Breaking Changes

- None expected for new installations.

## Known Limitations

- Limited mode sessions cannot perform inbox-level mutations (extend/delete account)
- Mail routing still depends on correct Cloudflare Email Routing setup per domain

## Maintainer

- Masanto
- GitHub: https://github.com/imnoob59
