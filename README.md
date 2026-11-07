# Learning Journal

A public learning journal. Visitors see today's entries first, then open earlier days, filter by activity, and read About, Stats, and Now. The owner signs in to add entries, update the profile, and attach a resume.

## What is included

- **Home:** day-grouped timeline. Today starts expanded; earlier days start collapsed. Filters for Lectures, Notes, Anki, Projects, Articles, Questions, and Images. Search, tags, resource links, and image or video cards.
- **About:** bio, education, experience, skills, and an optional PDF resume.
- **Stats:** study time, topics, streak, subject split, and a month activity calendar. Counts use the local calendar day.
- **Now:** today's entries, current focus, and daily goals.
- **Owner workflow:** server-side sessions; add, edit, and delete entries; public or draft status; YouTube and article previews; image and PDF upload; profile editing; daily goal completion. Sign-in lives in the footer.
- **Security:** scrypt password hashes, opaque server-side sessions, HttpOnly and SameSite cookies, origin checks, login and preview rate limits, SSRF protection for metadata URLs, upload magic-byte checks, request-size limits, CSP and other security headers, parameterized SQL.
- **Operations:** SQLite in WAL mode, health endpoint, graceful shutdown, Docker image, startup schema migration, seed data, and test, lint, and build scripts.

## Architecture

The app has no web framework. The `mssql` package is loaded only when Azure SQL is configured. Local development and tests use Node's built-in SQLite.

- `server/` — Node.js HTTP API, authentication, validation, metadata fetch, uploads, and either SQLite or Azure SQL.
- `src/` — framework-free client and styles.
- `tests/` — API and security tests using Node's built-in test runner.
- `scripts/` — syntax check and production asset build.

Node.js 22.13 or newer is required because the server uses `node:sqlite`. Node 24 LTS is a good choice.

## Local development

```bash
cp .env.example .env
# Replace ADMIN_PASSWORD in .env with a strong value.
npm run dev
```

Open <http://localhost:8787>. In development only, if no `.env` is present, the owner login is:

- Email: `owner@example.com`
- Password: `learning-journal-dev`

That fallback is disabled in production. Production refuses to boot without an admin email and a password of at least 12 characters.

`.env`, `data/*.db`, and `uploads/` are local. They are not part of the git repository. A fresh clone seeds a new journal.

## Quality checks

```bash
npm run check
```

This runs the syntax check, the test suite, and the production build. The separate commands are `npm run lint`, `npm test`, and `npm run build`.

## Environment variables

| Variable | Required | Description |
|---|---:|---|
| `NODE_ENV` | production | Runtime mode. |
| `PORT` | no | HTTP port. Defaults to `8787`. |
| `APP_ORIGIN` | production | Exact public origin used for mutation checks, for example `https://journal.example.com`. No trailing slash. |
| `DATABASE_PATH` | no | SQLite file. Defaults to `./data/journal.db`. |
| `UPLOAD_DIR` | no | Image and resume directory. Defaults to `./uploads`. |
| `ADMIN_EMAIL` | production | Owner login email. Used only when the database is first created. |
| `ADMIN_PASSWORD` | production | Initial owner password, at least 12 characters. Used only to create the first user. |
| `OWNER_NAME` | no | Display name written into a fresh database. |
| `OWNER_HANDLE` | no | Public handle written into a fresh database. |
| `AZURE_SQL_SERVER` | no | Azure SQL host, such as `journal.database.windows.net`. |
| `AZURE_SQL_DATABASE` | no | Database name on that server. |
| `AZURE_SQL_USER` | no | SQL admin login. |
| `AZURE_SQL_PASSWORD` | no | SQL admin password. Never commit this. |

When all four Azure SQL variables are set, the journal uses that database. When any of them is missing, it uses the local SQLite file. Tests always use an in-memory SQLite database. Uploaded images and resume PDFs stay in `UPLOAD_DIR`; Azure SQL stores the rows only.

Changing `ADMIN_PASSWORD` after the database exists does not change the stored password. Start from a new database if the owner account must change.

If `OWNER_NAME` is unset, a fresh database is seeded as Aryan. Set the two owner variables before the first boot to use another name.

## API summary

Public:

- `GET /api/health`
- `GET /api/bootstrap`
- `GET /api/entries?type=&search=&limit=`
- `GET /api/entries/:id`
- `GET /api/auth/session`

Owner-only:

- `POST /api/entries`, `PATCH /api/entries/:id`, `DELETE /api/entries/:id`
- `POST /api/meta/preview`
- `POST /api/uploads`
- `PATCH /api/profile`
- `POST /api/goals/:id/toggle`
- `POST /api/auth/logout`

Authentication: `POST /api/auth/login`.

## Running with Docker

1. Create `.env` with `ADMIN_EMAIL`, a strong `ADMIN_PASSWORD`, and the optional owner fields.
2. Set `APP_ORIGIN` in `docker-compose.yml` to the final HTTPS origin.
3. Run:

```bash
docker compose up -d --build
```

The container listens on port `8787` and stores the database and uploads in named volumes. Those volumes are required. A host with an ephemeral disk will wipe the journal on restart.

A public host has not been chosen. `render.yaml` is an unused blueprint for a paid container with a disk. Do not launch it for a free deployment: a free web service has no disk, so a SQLite journal would be wiped whenever the service sleeps. Azure SQL keeps the rows without that disk. The app process and the `uploads/` folder still need a machine that stays up.

## Backups

Back up the database and the uploads directory together. SQLite runs in WAL mode, so use the SQLite backup command or stop the process before copying the files.

## Production checklist

- Use a unique admin password of 16 characters or more.
- Set `APP_ORIGIN` to the exact HTTPS origin, with no trailing slash.
- Keep the database and uploads on persistent storage.
- Serve the app over HTTPS.
- Watch `/api/health`, restarts, disk use, and 5xx logs.
- Replace seeded profile details from the owner screens before sharing the journal.

## Data model

`users` point at `sessions`. `entries` link to `tags` through `entry_tags`. `profile` is a single row. `daily_goals` are stored by local date. Foreign keys are enforced, SQL is parameterized, and deleting an entry removes its tag links.
