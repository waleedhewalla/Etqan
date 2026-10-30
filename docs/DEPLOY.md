# Deploying Itqan

One server, Docker Compose, automatic HTTPS. Good for a staging environment and for a first pilot; see
[What this does not cover](#what-this-does-not-cover) before relying on it for more.

```
 internet ──443──▶ Caddy ──▶ web   (Next.js, app.example.org)
                      └────▶ api   (Fastify,  api.example.org) ──▶ Postgres
                                                              └──▶ recordings on a private volume
```

Only Caddy listens on the internet. Postgres is not published at all, and recordings are never served directly: only the API can read them.

## Before you start

| You need | Why |
|---|---|
| A Linux server (2 vCPU, 4 GB RAM, 30 GB disk is plenty for a pilot) with Docker and the Compose plugin | runs everything |
| **Two DNS names** pointing at the server's address, e.g. `app.example.org` and `api.example.org` | HTTPS certificates are issued per name. Ports 80 and 443 must be open. |
| **HTTPS** (Caddy does it) | browsers allow the microphone and the offline mode only on HTTPS |
| A **SendGrid** API key | staff sign in by an emailed link. Without it the API refuses to send links, so no teacher or dean can sign in. |
| **360dialog (WhatsApp)** credentials and the two **approved** message templates (`itqan_otp`, `itqan_absence_alert`) | students sign in with a code sent on WhatsApp, and guardians get absence alerts. Template approval by WhatsApp can take days: start early. |

Decide **where the server is**. Student data (names, phone numbers, recordings) is stored on it; choose a region that
satisfies your data-protection obligations (Egypt's PDPL, and your institution's own rules).

## First deployment

```bash
git clone https://github.com/waleedhewalla/Etqan.git && cd Etqan
cp .env.production.example .env
chmod 600 .env
```

1. **Fill in `.env`.** The file explains each value. Generate secrets with `openssl rand -hex 16` (database password)
   and `openssl rand -base64 36` (JWT secret). If a required value is missing, the next step stops and tells you which.
2. **Start it** (the first build takes several minutes):
   ```bash
   docker compose -f compose.prod.yml up -d --build
   docker compose -f compose.prod.yml ps        # everything "running"/"healthy"; migrate "exited (0)"
   ```
   Caddy fetches the certificates on first start. If it can't, check that both names resolve to this server and that
   ports 80/443 are open (`docker compose -f compose.prod.yml logs caddy`).
3. **Load the Quran text** (needs internet; the file is CC BY-SA 4.0: see the credits page and your licence decision):
   ```bash
   docker compose -f compose.prod.yml run --rm api node dist/quran-seed.mjs
   ```
4. **Create the first institution, its dean, a teacher and a halaqa** (production has no demo data):
   ```bash
   docker compose -f compose.prod.yml run --rm api node dist/bootstrap.mjs \
     --slug azhar-pilot --name "كلية الأزهر للبنات" --plan madrasa_pro \
     --dean-email dean@example.org --dean-name "د. فلانة" \
     --teacher-email teacher@example.org --teacher-name "أ. فلانة" \
     --halaqa "حلقة سورة البقرة"
   ```
   It prints the halaqa's **join code**, which students use to sign up. Safe to run again. `--plan` matters: AI checking is only
   included in `madrasa_pro` and `enterprise`.
5. **Check it works**, from your own computer:
   - `https://api.example.org/v1/health` shows `{"status":"ok"…}`
   - open `https://app.example.org/auth/login/faculty`, enter the dean's email, and use the link that arrives. You land on the admin console.
   - on a phone, sign up as a student with the join code (a WhatsApp code arrives).

## Audio storage

Recordings are private files on a Docker volume (`audio_data`) attached to the API. Nothing else to run, and browsers never reach
the files: the API checks who may listen and streams the audio itself. They are short-lived by design (24 hours after a teacher
reviews them, 30 days if nobody does), so the volume stays small.

The trade-off: files on one server's disk mean **one API server**. To run the API on several machines, or to keep recordings off this
server, use a managed S3-compatible service (AWS S3, Wasabi, Cloudflare R2, a provider in your region): set `STORAGE_DRIVER=s3`,
`MINIO_ENDPOINT`, `MINIO_REGION`, `MINIO_BUCKET` and the key pair in `.env`. The S3 driver has only been tested against a local S3
emulator, not against those services: try a recording end to end before relying on it.

(An earlier version of this stack ran MinIO. MinIO no longer publishes images and no longer maintains its community edition, so it
was removed rather than pinned to an image that cannot be pulled.)

## Settings you may change later

Edit `.env`, then `docker compose -f compose.prod.yml up -d` (the web app is rebuilt only if `API_DOMAIN` changed: add `--build`).

- `PLAN_ENFORCEMENT=block` to refuse new students and halaqat when an institution is full or its plan has expired.
- `ENABLE_ASR`, `ASR_*`: the automatic first check of recitations. **Read the open questions in TESTING.md first**: audio is sent to the service you name.
- `AUDIO_RETENTION_HOURS`, `AUDIO_UNREVIEWED_MAX_DAYS`: how long recordings are kept. The privacy page states 24 hours after review and 30 days if never reviewed; change the page too if you change these.

## Updating

```bash
git pull
docker compose -f compose.prod.yml up -d --build      # migrations run automatically before the API restarts
docker compose -f compose.prod.yml logs -f api
```

Migrations only move forward. Take a [backup](#backups) first.

## Backups

The database is the asset that matters (accounts, progress, scores, notes). Recordings are short-lived by design.

```bash
# back up (do this on a schedule: cron, and copy the file OFF the server)
docker compose -f compose.prod.yml exec -T postgres pg_dump -U itqan -Fc itqan > itqan-$(date +%F).dump

# restore into a running stack (this replaces what is there)
docker compose -f compose.prod.yml exec -T postgres pg_restore -U itqan -d itqan --clean --if-exists < itqan-2026-01-01.dump
```

**Try a restore before you need one**, on a spare machine. A backup you have never restored is a hope.
Optional recordings volume: `docker run --rm -v itqan_audio_data:/data -v "$PWD":/out alpine tar czf /out/audio-$(date +%F).tgz /data`.

## Day to day

```bash
docker compose -f compose.prod.yml logs -f api          # what the API is doing
docker compose -f compose.prod.yml restart api
docker compose -f compose.prod.yml ps
df -h && docker system df                                # disk
```

Changing `JWT_SECRET` signs everyone out. Changing `POSTGRES_PASSWORD` in `.env` does **not** change it inside an existing
database: change it with `ALTER USER` first.

## If something is wrong

| Symptom | Likely cause |
|---|---|
| The API container keeps restarting with **"Refusing to start in production"** | a secret is still a public development default (JWT secret, database password, or S3 keys) or `STORAGE_DRIVER=memory`. The message names which. |
| Browser shows CORS errors | `APP_DOMAIN` in `.env` doesn't match the address in the browser (including `https://` and no trailing slash) |
| Pages load but nothing works | the web app was built for a different `API_DOMAIN`. Fix `.env`, then `up -d --build`. |
| Nobody can sign in | missing SendGrid or WhatsApp credentials, or the WhatsApp templates are not approved yet (see the API log) |
| "Too many requests" for everyone at once | `TRUST_PROXY` is not on, so everyone shares the proxy's address (it is on in `compose.prod.yml`; check you did not change it) |
| Certificate errors | DNS not yet pointing at the server, or ports 80/443 blocked |

## What this does not cover

Be honest with yourself about these before a pilot with real students:

- **No monitoring or alerting.** Nobody is paged when it goes down. Add an uptime check on `/v1/health` at least.
- **No high availability.** One server: if it dies, the service is down until you restore from a backup.
- **Backups are manual.** The commands above are not scheduled and not copied off the server for you.
- **No log shipping**, no metrics, no automatic OS or Docker updates.
- **Not load-tested.** It has run with a handful of users, not a school-wide rollout.
- **Fawry / payments** are not built; plans are set directly on the institution (`bootstrap --plan`, or the database).
- The real recitation checker has not been proven on real audio (see TESTING.md).
