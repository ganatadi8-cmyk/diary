# Daily Diary

A private journal with a calendar, Telugu/English writing, editable entries, search, and JSON export. The frontend is plain HTML/CSS/JavaScript and the API is Flask + SQLAlchemy.

## Database choice

**PostgreSQL, hosted on Neon, is the recommended production database.** Accounts, entries, and revocable sessions are relational data. PostgreSQL gives them durable storage outside the serverless filesystem. Use Neon's pooled connection URL with the Python `psycopg` driver. Supabase PostgreSQL or another PostgreSQL host also works.

SQLite is supported for local development only. The old Vercel `/tmp/diary.db` database was ephemeral; this version refuses to start in production with SQLite or without a strong session secret. Diary text belongs in the database; a separate object-storage service is unnecessary until attachments are added.

## Improvements

- Password hashes replace plaintext passwords; the shared administrator shortcut has been removed.
- HttpOnly, SameSite cookies plus CSRF tokens replace editable `X-User-Id` headers and local-storage login state.
- Database sessions expire after seven days and are revoked by sign-out or password reset.
- Every entry query, update, delete, and export is scoped to the signed-in account, including former administrators.
- Database-backed throttling applies to login, registration, and writing assistance across instances.
- Edit entries, search titles/content, browse dates, view entry/day counts, and export your own complete diary.
- Failed saves retain editor text; pending submissions disable the save control. If a connection fails after a save, refresh the list before retrying because the server may already have committed it.
- Keyboard-accessible dates, labelled forms, mobile layout, reduced-motion support, and readable error states.
- Writing assistance is optional. It sends text to Gemini only when requested and previews the suggestion before applying. There is no silent third-party translation fallback.

## Run locally

Use Python 3.12 or newer. From the repository root:

```bash
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements-dev.txt
cp .env.example .env
# Windows PowerShell: Copy-Item .env.example .env
python -c "import secrets; print(secrets.token_hex(32))"
```

Paste the generated value into `SECRET_KEY` in `.env`. Keep `DATABASE_URL=sqlite:///diary.db` for local development. Do not commit `.env`.

```bash
python -m flask --app backend.app init-db
python -m flask --app backend.app run --port 5000
```

Open <http://127.0.0.1:5000>. Flask serves both the frontend and API on the same origin; do not run the frontend on a separate Live Server port. The SQLite file is in Flask's `backend/instance` directory. A stable `SECRET_KEY` preserves sessions across restarts.

## Production setup on Vercel + Neon

The repository includes Vercel routing for the static frontend and Flask API. Database provisioning and deployment credentials are separate from this code.

1. In the existing Vercel project, add **Neon** from the Storage/Marketplace area and connect the database to the project. Choose a database region near your Vercel function region. Use separate databases/branches for Preview and Production.
2. Set `DATABASE_URL` to the **pooled PostgreSQL connection URL**, keeping its TLS parameters (for example `sslmode=require`). The app accepts `postgres://`, `postgresql://`, or `postgresql+psycopg://` URLs. SQLAlchemy uses `NullPool` so the provider handles pooling across serverless instances.
3. Add a random `SECRET_KEY` (at least 32 characters) to the corresponding Vercel environment. Generate it with the command above. Vercel sets `VERCEL`, which enables Secure cookies and production validation. On other hosts set `APP_ENV=production`.
4. In a trusted local terminal, set `.env` to the destination's database URL and run the schema command once **before deployment**:

   ```bash
   python -m flask --app backend.app init-db
   ```

   This creates schema v1 and does not delete existing records. It is intentionally not run on cold starts. It does not alter older table definitions; use a fresh PostgreSQL database and the import procedure below for the original SQLite app. Future schema changes need a reviewed migration.
5. If old diary data is available, import and check it before switching traffic. Reset legacy passwords as described below.
6. Deploy the reviewed branch/merge on Vercel. Check `/api/health` returns `{"status":"ok","storage":"postgresql"}`. Register two test accounts and confirm each sees only its own entries.
7. Optional: set `GEMINI_API_KEY` and `GEMINI_MODEL` to enable writing suggestions, then redeploy. Without them, saving and reading still work.

Never put the database URL, secret key, or Gemini key in frontend code. Keep provider backups enabled as appropriate for your plan, and test restoration. JSON export provides a personal download, not an automated system backup. Configure hosting-level abuse controls for public traffic as well as the built-in account/source limits.

## Move existing SQLite data safely

The migration reads the original SQLite file without modifying it and imports into an **empty initialized destination**. Back up the source first. Data already lost from Vercel's old ephemeral filesystem cannot be recovered from this repository.

```bash
# DATABASE_URL in .env must point to the fresh destination database.
python -m flask --app backend.app init-db
python -m flask --app backend.app import-sqlite /absolute/path/to/old/diary.db
```

The import preserves names, entry text, and dates; remaps internal IDs; hashes legacy plaintext passwords; and removes administrator access to other people's entries. A failure rolls back the destination transaction. A non-empty destination is rejected to prevent duplicate imports. The old database may contain exposed passwords, so reset all migrated passwords before public launch:

```bash
python -m flask --app backend.app reset-password "Account name"
```

This prompts securely for a new password and revokes the account's sessions. There is no self-service email recovery yet. Only a trusted operator with database access should run this command. Entries are protected by account authorization, not end-to-end encryption; database operators can access stored contents.

Periodically remove expired session and rate-limit rows:

```bash
python -m flask --app backend.app cleanup-sessions
```

## Tests

```bash
python -m pytest -q
node --check frontend/app.js
```

The GitHub Actions workflow runs the same regression suite against SQLite and a PostgreSQL 17 service. To test PostgreSQL locally, use a **dedicated disposable database named `diary_test`** and set `TEST_DATABASE_URL`. Tests drop/recreate its tables; never use a real diary database.

Coverage includes cookie/CSRF protection, password hashing, user isolation, former admin isolation, edit/delete/export, session replay and expiry, restart persistence, validation, throttling, AI failures, import rollback, and password recovery. Gemini tests mock the provider; a real provider call needs your key.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/session` | Current account and CSRF token |
| `POST /api/register`, `POST /api/login` | Start an authenticated session |
| `POST /api/logout` | Revoke the current session |
| `GET /api/entries`, `POST /api/entries` | List or create your entries |
| `PUT /api/entries/:id`, `DELETE /api/entries/:id` | Edit or delete your entry |
| `GET /api/export` | Download your entries as JSON |
| `POST /api/ai-agent` | Request a writing suggestion |
| `GET /api/health` | Database connectivity/schema readiness |

Every mutation requires `X-CSRF-Token` from `/api/session`. Diary endpoints require the session cookie. Entry bodies contain `title` (1–100 characters), `content` (1–20,000), and `date` (`YYYY-MM-DD`). Names are case-sensitive; passwords are 8–128 characters for new accounts.

The current UI loads the account's full journal for client-side search and calendar markers; server-side pagination/search is a future step for very large journals.
