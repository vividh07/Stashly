# Stashly

**A personal digital vault for everything worth keeping.**

Capture links, notes, files, images, audio, and video from any device. Store them privately. Find them instantly.

Built for people who want one quiet place for their digital life — not another cluttered cloud drive.

---

## Why

Bookmarks scatter across browsers. Screenshots die in Downloads. Notes live in five apps. Stashly is a single, private inbox for all of it — with fast capture, strong ownership boundaries, and storage you control.

## Features

- **Quick capture** — save a URL (with metadata), a note, or a file in one step
- **Libraries** — inbox, type shelves, favorites, archive, and trash
- **Search** — global keyword search (API shaped for semantic search later)
- **Private storage** — Cloudflare R2, no public bucket; 10 GB app-level quota with reservation locking
- **Secure by default** — HTTP-only session cookies, CSRF protection, SSRF blocking on URL capture
- **Works offline-ish** — optimistic UI, IndexedDB pending uploads, background sync
- **Browser extension** — one-click save from any page (`apps/extension`)
- **Share targets** — web share / capture flows for mobile and desktop

## Stack

| Layer | Tech |
|-------|------|
| Web | React, Vite, Tailwind → Cloudflare Pages |
| API | Hono → Cloudflare Workers (+ Node for local) |
| Data | MongoDB Atlas |
| Objects | Cloudflare R2 |
| Shared | Zod schemas in `packages/shared` |

```
apps/web          Vite React frontend (PWA-ready)
apps/api          Hono API (Worker + local Node)
apps/extension    Chrome MV3 “save to vault” extension
packages/shared   Shared types & validation
```

## Quick start

**Requirements:** Node 20+, pnpm 9, a MongoDB Atlas URI, and Cloudflare R2 credentials.

```bash
pnpm install
pnpm --filter @vault/shared build
# copy env template → .env / apps/api/.dev.vars
pnpm dev
```

| Service | URL |
|---------|-----|
| Web | http://127.0.0.1:4173 |
| API | http://127.0.0.1:8787 |

First user: open the app and **Create account** (allowed when the user collection is empty), or set `BOOTSTRAP_ADMIN_*` and run `pnpm seed`.

```bash
pnpm test      # API + web
pnpm build     # shared → api → web
```

## API surface

| Area | Endpoints |
|------|-----------|
| Auth | `POST /api/auth/login\|logout\|register` · `GET/PATCH /api/auth/me` |
| Items | `GET/POST /api/items` · `GET/PATCH/DELETE /api/items/:id` · bulk |
| Capture | `POST /api/capture` · `/url` · `/note` |
| Storage | upload / complete / download / usage · direct stream to R2 |
| Other | tags · search · dashboard · share · export |

Health: `GET /api/health`

## Configuration

### MongoDB Atlas

1. Create a cluster + database user  
2. Allow your Worker egress (or `0.0.0.0/0` for personal use with strong credentials)  
3. Set `MONGODB_URI`  
4. Indexes (text, ownership, status, session TTL) are created on boot  

### Cloudflare R2

Private bucket (e.g. `personal-vault`). Required:

- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

Uploads go **browser → API → R2** (`PUT /api/storage/direct/:uploadId`) via the Vite proxy / Pages function, so bucket CORS is optional for the default path. Large files use multipart streaming. See `r2-cors.json` if you enable browser→R2 presigned PUTs later.

## Deploy

### API (Workers)

```bash
cd apps/api
pnpm exec wrangler secret put MONGODB_URI
pnpm exec wrangler secret put JWT_SECRET
pnpm exec wrangler secret put CSRF_SECRET
pnpm exec wrangler secret put R2_ACCESS_KEY_ID
pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY
pnpm exec wrangler secret put CLOUDFLARE_ACCOUNT_ID
pnpm exec wrangler secret put R2_ENDPOINT
pnpm deploy
```

Set `CORS_ORIGIN`, `ALLOW_REGISTRATION=false`, quota, and bucket name in `wrangler.toml` `[vars]`.

> Workers need `nodejs_compat` (already enabled) for the Mongo driver. If Atlas TCP is blocked from your Worker region, run the API on a Node host that can reach Atlas and keep R2 for objects.

### Web (Pages)

```bash
cd apps/web
pnpm build
pnpm exec wrangler pages deploy dist --project-name=stashly
```

Proxy `/api/*` to the Worker (Pages Functions / `_redirects`) so the app stays same-origin.

## Production checklist

- [ ] `ALLOW_REGISTRATION=false`
- [ ] Unique strong `JWT_SECRET` / `CSRF_SECRET`
- [ ] Rotate any bootstrap admin password after first login
- [ ] R2 bucket private; no public access
- [ ] Explicit CORS origins (never `*` with credentials)
- [ ] MongoDB least-privilege user + restricted network
- [ ] HTTPS only (Secure cookies)
- [ ] No secrets in the frontend bundle
- [ ] Short presigned URL TTL (default 15 minutes)

## Contributors

- [Vividh Choudhary](https://github.com/vividh07)

## License

Private / personal project unless otherwise stated.
