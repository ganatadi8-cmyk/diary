# Deploy Daily Diary and access its database

The app is available at <https://diary-ten-alpha.vercel.app>. Sign-in and saving require the production environment variables below. GitHub stores the application code; Vercel stores the private configuration that connects it to Neon. Committing this guide or changing `.env.example` does not create those variables in Vercel.

## Existing project

| Setting | Value |
| --- | --- |
| GitHub repository | [ganatadi8-cmyk/diary](https://github.com/ganatadi8-cmyk/diary) |
| Production branch | `main` |
| Vercel project | [diary](https://vercel.com/ganatadi8-cmyks-projects/diary) |
| Neon project | `daily-diary` |
| Neon branch | `production` |
| Database | `diary` |
| Database role | `diary_owner` |

The existing Neon database already has the application's four tables: `user`, `entry`, `login_session`, and `rate_bucket`. Use this database when completing the deployment.

## 1. Add the two Vercel variables

Open [diary's Environment Variables settings](https://vercel.com/ganatadi8-cmyks-projects/diary/settings/environment-variables). Select **Add Environment Variable** for each row, choose **Production**, and save the value as a **Secret**.

| Name | Private value |
| --- | --- |
| `DATABASE_URL` | The pooled PostgreSQL connection string from the Neon Connect dialog |
| `SECRET_KEY` | A freshly generated random secret of at least 32 characters |

To get `DATABASE_URL`:

1. Open the [Neon console](https://console.neon.tech) and select **daily-diary**.
2. Click **Connect**. Select branch **production**, database **diary**, and role **diary_owner**.
3. Leave **Connection pooling** enabled. Copy the PostgreSQL connection string, including its TLS parameters.
4. Paste only the URL into the Vercel value field. Do not include `DATABASE_URL=`, `psql`, or surrounding quotes. The pooled hostname contains `-pooler`.

Generate `SECRET_KEY` in a trusted terminal:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Copy the resulting value into Vercel. Keep both values private; do not put them in GitHub files, issues, screenshots, or chat. Keep the same secret across normal deployments; replacing it signs users out.

Leave **Enable access to System Environment Variables** checked. Vercel supplies `VERCEL`, which enables this app's production checks. `APP_ENV` is not needed on Vercel. For another host, set `APP_ENV=production`.

Preview deployments need their own database or Neon branch and a separate secret. Do not give Preview deployments the production connection string. `GEMINI_API_KEY` is optional; normal diary features work without writing assistance.

## 2. Redeploy

After saving both variables, open **Deployments**, select the latest production deployment from `main`, open its **...** menu, and choose **Redeploy**. Wait until it is ready. Vercel applies environment changes to new deployments; an earlier deployment will keep its old configuration.

If you use a new empty database instead of the existing one, initialize its schema before routing traffic to it. From a trusted local checkout, install `requirements.txt`, put that database URL and the generated secret in the ignored `.env` file, then run:

```bash
python -m flask --app backend.app init-db
```

This creates missing tables without deleting records. It does not migrate older table definitions. The existing `daily-diary` production database has already been initialized.

## 3. Verify the public app

1. Open [the health endpoint](https://diary-ten-alpha.vercel.app/api/health). It must return HTTP 200 with `{"status":"ok","storage":"postgresql"}`.
2. Open [Daily Diary](https://diary-ten-alpha.vercel.app), create an account with an 8–128 character password, and save a test entry.
3. Reload the page and confirm the entry remains. Sign out, sign back in, and confirm it is still available.
4. A separate account should see only its own diary. The public site URL lets people create accounts; it does not give them database administration access.

If the homepage loads but the health endpoint returns `FUNCTION_INVOCATION_FAILED`, inspect the production deployment's runtime logs. This app deliberately stops startup when `SECRET_KEY` is missing/too short or `DATABASE_URL` is missing/not PostgreSQL. Check that both values apply to **Production**, then redeploy. Other startup errors can produce the same Vercel message, so use the logs to confirm the cause.

If health reports storage unavailable, verify the connection string, database/branch selection, and schema. A successful build alone does not verify database connectivity.

## Database access for the owner

In the [Neon console](https://console.neon.tech), choose **daily-diary → production → diary**. Use **SQL Editor** to inspect the database. To check row counts without displaying diary contents or authentication data, run:

```sql
SELECT
  (SELECT COUNT(*) FROM public."user") AS accounts,
  (SELECT COUNT(*) FROM public.entry) AS entries;
```

The `diary_owner` connection string grants database access and must stay private. App users sign in with their diary accounts; they do not need a Neon account or this connection string. Diary contents are protected by application access controls, not end-to-end encryption; database administrators can read them. Passwords are stored as hashes and cannot be displayed as the original password. See the [password reset procedure](../README.md#move-existing-sqlite-data-safely) if an account needs recovery.

References: [Vercel environment variables](https://vercel.com/docs/environment-variables) and [Neon connection strings](https://neon.com/docs/connect/connect-from-any-app).
