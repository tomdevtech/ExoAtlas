# Deployment

ExoAtlas runs on Vercel with a hosted PostgreSQL database. This page describes how a change gets online, what has to be set up once, and what to keep in mind.

## How a change gets online

Vercel watches the GitHub repository. Nobody has to start a deployment:

| You push to | Vercel builds | Address |
| --- | --- | --- |
| `main` | a **production** deployment | the real address of the site |
| any other branch, or a pull request | a **preview** deployment | its own address, linked in the pull request |

The build command comes from [vercel.json](../vercel.json): first `npm run db:migrate-on-deploy`, then `npm run build`. For a production deployment the first step brings the database up to date (see [Migrations](#migrations)). If a step fails, the deployment that is live stays as it is.

GitHub Actions runs the checks in [ci.yml](../.github/workflows/ci.yml) at the same time: type check, lint, unit, database and browser tests, `npm audit` and the build. **Vercel does not wait for them.** So that only checked code reaches production, protect `main` (see step 4 below): changes then reach `main` only through a pull request whose checks are green.

Once a deployment is ready, [deploy-check.yml](../.github/workflows/deploy-check.yml) smoke-tests it under its own address: is it up, does it reach its database, do the main pages work? If that fails for a production deployment, the workflow puts the previous one back live (see [Smoke test after each deployment](#smoke-test-after-each-deployment) and [Automatic rollback](#automatic-rollback)). Once an hour, [health.yml](../.github/workflows/health.yml) asks the live site whether it is still up.

The NASA sync does not run on Vercel. [sync.yml](../.github/workflows/sync.yml) starts it once a day in GitHub Actions.

```
pull request ──► CI (checks)          ──┐
             └─► Vercel (preview) ──► smoke test
                                        ├─ merge when green ──► main ──► Vercel (production)
                                        │                                 ├─ migrations, then build
                                        │                                 └─► smoke test ──✗──► rollback to the previous deployment
GitHub Actions, daily ──► NASA sync ──► production database ◄── the live site reads from it
GitHub Actions, hourly ──► GET /health on the live site
```

## Setting it up once

### 1. Database

Any hosted PostgreSQL that allows the extension `pg_trgm` works, for example Neon (also available in the Vercel Marketplace) or Supabase. Note two addresses:

- **pooled**: goes through the pooler of the provider. The site uses it, because Vercel starts many instances at once and each keeps up to `DATABASE_POOL_SIZE` connections.
- **direct** (unpooled): goes straight to the database. Migrations, the sync and the seed use it.

Neon calls them `DATABASE_URL` and `DATABASE_URL_UNPOOLED` and, when connected through the Vercel Marketplace, sets them in the Vercel project itself. Both belong to the owner role, which may change everything. The site itself only reads; step 7 gives it a role of its own that may only read.

If the pooler runs in transaction mode and does not support prepared statements (Supabase on port 6543, for example), set `DATABASE_PREPARE=false`.

### 2. Vercel project

In Vercel: *Add New → Project*, choose the repository. Vercel recognises Next.js; the build command comes from `vercel.json`. Select **Deploy** without setting any variable: this first build fails, because there is no database yet. Then set *Settings → Functions → Function Region* to the region of the database (Frankfurt, `fra1`, for a database in `eu-central-1`).

All variables of the project at a glance, under *Settings → Environment Variables*. Most of them are set in later steps:

| Variable | Environments | Content | Comes from |
| --- | --- | --- | --- |
| `DATABASE_URL` | Production, Preview | pooled address | set by Vercel when you connect the database (step 1) |
| `DATABASE_URL_UNPOOLED` | Production | direct address, for the migrations | set by Vercel when you connect the database (step 1) |
| `DATABASE_PREPARE` | Production, Preview | only if needed, see above | you, only with such a pooler |
| `LEGAL_NAME`, `LEGAL_STREET`, `LEGAL_CITY`, `LEGAL_EMAIL` | Production | the operator, see [.env.example](../.env.example) | you, after the database |
| `LEGAL_HOSTING`, `LEGAL_HOSTING_TRANSFER`, `LEGAL_HOSTING_DPA` | Production | the host | fixed texts, see [Legal pages](#legal-pages) |
| `LEGAL_COUNTRY`, `LEGAL_PHONE`, `LEGAL_EMAIL_PROVIDER`, `LEGAL_LOG_DAYS` | Production | optional | you, see [Legal pages](#legal-pages) |
| `DATABASE_URL_READONLY` | Production | the address of the read-only role | printed by `npm run db:readonly-role` (step 7) |

Once the database and the `LEGAL_*` values are set, deploy again (*Deployments → … → Redeploy*): this build creates the tables.

The `LEGAL_*` values are read when the app is built. After changing one, deploy again (*Deployments → … → Redeploy*).

### 3. Secret for the sync

In GitHub: *Settings → Secrets and variables → Actions → New repository secret*, name `PRODUCTION_DATABASE_URL`, value the **direct** address of the database.

### 4. Protect `main`

In GitHub: *Settings → Branches → Add branch ruleset* (or *Branch protection rule*) for `main`:

- require a pull request before merging,
- require these status checks to pass: `check`, `audit`, `db` and `e2e` from CI, and `analyze` from CodeQL. They appear in the list once they have run for the first time.

### 5. First deployment and first data

1. Push to `main` or merge a pull request. The production build creates the tables.
2. In GitHub: *Actions → Sync with NASA → Run workflow*, tick **Store the solar system**. This fills the empty database. After that the workflow runs every day by itself.
3. Open the site and check a planet page, the search and the map.

### 6. Smoke test, rollback and monitoring

Without this step the site works, but nothing notices when a deployment is broken. What each part does is described below.

1. **Deployment Protection.** In Vercel, *Settings → Deployment Protection*: if it is on (by default it protects every address except the production domain), create a secret under *Protection Bypass for Automation*. Store it in GitHub (*Settings → Secrets and variables → Actions → Secrets*) as `VERCEL_AUTOMATION_BYPASS_SECRET`.
2. **Token for the rollback.** In Vercel, *Account Settings → Tokens*: create a token with access to the team of the project. Store it in GitHub as the secret `VERCEL_TOKEN`.
3. **Project and team.** In GitHub, under *Variables* (not *Secrets*), set `VERCEL_PROJECT_ID` (Vercel: project *Settings → General → Project ID*) and `VERCEL_ORG_ID` (the team ID under *Team Settings → General*, or for a personal account the user ID under *Account Settings*). `npx vercel link` also writes both into `.vercel/project.json`.
4. **Live address.** In GitHub, set the variable `PRODUCTION_URL` to the address of the site, for example `https://exoatlas.example.org`.
5. **Uptime service (recommended).** Let a monitoring service such as UptimeRobot or Better Stack ask `https://<your domain>/legal/notice` every few minutes and e-mail you when it does not answer 200. Not `/health`: that asks the database, and a check every few minutes would keep a Neon database from ever going to sleep. On the free plan that alone would use more compute time than included (about 180 of 100 CU-hours a month at 0.25 CU). The legal notice is a prebuilt page without the database, so it shows whether the site is up; the hourly check of `/health` in GitHub Actions covers the database.

Without the secrets the checks still run; the rollback then fails with a message that names the missing value, and the run turns red.

### 7. Security

The site has no logins, forms, cookies or uploads, so most of a usual security checklist does not apply. What remains, in order of importance:

1. **Two-factor sign-in** on every account that can change the site: GitHub, Vercel, Neon, Namecheap and the e-mail account they send their messages to. These accounts are the real way in: whoever controls one of them controls the site.
2. **Read-only role.** After the first deployment, run on your computer with the owner addresses from Neon (*Neon console → Connect*, or the Vercel variables):

   ```bash
   DATABASE_URL="<pooled owner address>" DATABASE_URL_UNPOOLED="<direct owner address>" npm run db:readonly-role
   ```

   Store the address it prints in Vercel as `DATABASE_URL_READONLY` (Production) and deploy again. See [Read-only database role](#read-only-database-role).
3. **Rate limit** for the search, see [Rate limiting](#rate-limiting).
4. **Domain** at Namecheap, see [Domain](#domain).
5. **Backups** run by themselves once `PRODUCTION_DATABASE_URL` is set (step 3), see [Backups](#backups). Try a restore once.
6. **After going live**, test the address at [SSL Labs](https://www.ssllabs.com/ssltest/) (expected: A or better) and [securityheaders.com](https://securityheaders.com).

## Health check and monitoring

`GET /health` ([route.ts](../src/app/health/route.ts)) answers 200 with `{"status":"ok","database":"ok","commit":"abc1234"}` when the site reaches its database within three seconds, and 503 with `"database":"unreachable"` when it does not. `commit` is the deployed Git commit; Vercel provides it, locally it is `null`. The answer is never cached and names no detail of a failure; the details go to the function log in Vercel.

On Vercel there is no server process that could hang and would need a restart: every request runs in a function that Vercel starts and replaces by itself. The health check therefore serves to *notice* problems, mostly a database that is down or a wrong `DATABASE_URL`:

- [health.yml](../.github/workflows/health.yml) asks it once an hour (needs the variable `PRODUCTION_URL`). After three failed tries a minute apart the run turns red and GitHub sends an e-mail. GitHub may start scheduled runs some minutes late, and it switches them off after 60 days without activity in a public repository.
- An uptime service (step 6.5) checks more often and more reliably whether the site answers, using `/legal/notice` so that the database can sleep in between.

`/health` is not rate limited of its own: it costs one `select 1`, and the Vercel Firewall's DDoS protection stops floods. The one rate limit rule of the Hobby plan goes to the search, which asks the database far more.

## Smoke test after each deployment

When Vercel has finished a deployment, it reports it to GitHub. [deploy-check.yml](../.github/workflows/deploy-check.yml) then runs `npm run test:smoke` ([smoke/](../smoke)) against the deployment's own address, for previews and production alike. In about a minute it checks:

- `/health` answers 200 and the deployment runs the commit it was started for,
- the start page, the planet list, a planet and a star page, the search, the map and the legal pages answer 200 with the security headers,
- the JSON endpoints answer with data from the database,
- in Chromium: from the start page to a planet, the list and the search, without errors in the browser console.

It only relies on the solar system, which every filled database has. Failed tests are retried twice, so a short network hiccup does not count. The browser tests in CI run the same smoke test against the local build, so a change to the pages that would break it shows up before it is merged.

By hand, against any address:

```bash
SMOKE_BASE_URL=https://exoatlas-abc123.vercel.app npm run test:smoke
```

Vercel puts its toolbar into preview deployments. The Content Security Policy of the site blocks it, so it does not appear in previews. The smoke test ignores the resulting messages in the browser console.

## Automatic rollback

If the smoke test of a **production** deployment fails, the second job of [deploy-check.yml](../.github/workflows/deploy-check.yml) runs `npm run deploy:rollback` ([rollback-production.ts](../scripts/rollback-production.ts)): it asks the Vercel CLI for the newest earlier production deployment that is ready and makes it live again with `vercel rollback`. The run turns red, GitHub sends an e-mail, and the summary of the run says what happened.

No rollback happens when the smoke test could not open the deployment at all (Deployment Protection without the bypass secret): that is a setup problem, not a broken deployment. Previews are never rolled back.

What to know:

- **Only the code goes back, not the database.** The migrations of the failed deployment stay. That is why a migration must never break the code before it (see [Migrations](#migrations)): then the old code keeps working with the new tables.
- **After a rollback, Vercel holds back new production deployments.** Pushes to `main` are built, but do not go live by themselves until a deployment is promoted by hand: fix the problem, wait for the new deployment and its smoke test, then *Deployments → … → Promote* in Vercel (or `npx vercel promote <address>`).
- On the Hobby plan Vercel can only roll back to the deployment directly before the current one. That is the one the script picks anyway.
- Rolling back by hand: *Deployments → … → Instant Rollback* in Vercel.

## Migrations

`npm run db:migrate-on-deploy` ([scripts/migrate-on-deploy.ts](../scripts/migrate-on-deploy.ts)) applies the migrations in `drizzle/` before the production build. It does nothing for a local `npm run build` or for preview deployments.

The new migration runs a minute or two before the new code goes live, so the old code briefly works with the new tables. A migration must therefore not break the code that is still live: add columns and tables first, and remove old ones in a later deployment.

Preview deployments use the production database unless they get their own. A preview whose code expects a newer schema then fails until the change is merged. If the provider can create a database branch for each preview (Neon can), set `DATABASE_MIGRATE_ON_BUILD=true` for the Preview environment: previews then migrate their own branch.

## The daily sync

[sync.yml](../.github/workflows/sync.yml) runs `npm run sync` every day at 03:17 UTC against `PRODUCTION_DATABASE_URL`. When it fails, for example because the answer from NASA looked implausible, the run turns red and GitHub sends an e-mail. Started by hand, it can also store the solar system or force the sync (`--force`).

GitHub switches off scheduled workflows of a public repository after 60 days without activity in it. It says so by e-mail; *Actions → Sync with NASA → Enable workflow* switches it on again.

## Read-only database role

The website never writes to the database; only the sync and the seed do. `npm run db:readonly-role` ([create-readonly-role.ts](../scripts/create-readonly-role.ts), statements in [readonly.ts](../src/db/readonly.ts)) creates the role `exoatlas_web`:

- it may read every table, also those of later migrations, and nothing else: no writing, no deleting, no new tables,
- every transaction is read-only, and a query is cancelled after 5 seconds, so one expensive query cannot tie up the database.

Inside the Next.js server the site connects with `DATABASE_URL_READONLY` when that is set ([client.ts](../src/db/client.ts)); scripts and tests always take `DATABASE_URL`. A flaw in a query of the website can therefore read the public catalogue at most, never change it.

Running the command again gives the role a new password; store the new address in Vercel and deploy again. If the role is missing or its address is wrong, `/health` answers 503 and the smoke test rolls the deployment back.

## Rate limiting

Every search, and every suggestion while typing, asks the database. A rule in the Vercel Firewall stops a single source from flooding it. Available on the Hobby plan too (one rate limit rule per project):

*Vercel → project → Firewall → Configure → + New Rule*

| Field | Value |
| --- | --- |
| Name | `Search rate limit` |
| If | *Request Path* · *starts with* · `/search` |
| Then | *Rate Limit* · *Fixed Window* · 60 s · 100 requests · key *IP* |
| Action | *Too Many Requests (429)* |

Then *Review Changes → Publish*. Someone who types fast sends a few suggestion requests per second, so 100 per minute leaves room for real visitors, also several behind one shared address. Do **not** choose *Challenge*: it sets a cookie, and the privacy policy says there are none.

## Backups

[backup.yml](../.github/workflows/backup.yml) dumps the production database every Sunday with `pg_dump` and keeps the dump for 90 days as an artifact of the run. Most of the data could be fetched from NASA again; the dump keeps what could not: the change history, former names and the sync runs. The database holds no personal data. Neon keeps its own short history in addition, which helps after a mistake of the last hours.

To restore: download the artifact from *Actions → Database backup → a run*, unpack it, and load it into an empty database with the owner's direct address:

```bash
docker run --rm -v "$PWD:/backup" -e TARGET="<direct owner address>" postgres:18 \
  sh -c 'pg_restore --dbname="$TARGET" --clean --if-exists --no-owner --no-privileges /backup/exoatlas.dump'
```

Then run `npm run db:readonly-role` again, so that the read-only role can read the restored tables.

## Domain

The domain is registered at Namecheap; its DNS points at Vercel. In Namecheap, under *Domain List → Manage*:

- keep **Registrar Lock** on, so that the domain cannot be moved to another registrar without you,
- switch on **DNSSEC** (*Advanced DNS*), as long as Namecheap serves the DNS records,
- add a **CAA** record so that only the certificate authority Vercel uses may issue certificates for the domain: `@  CAA  0 issue "letsencrypt.org"`. Check Vercel's current documentation on custom domains first; if Vercel names other authorities, list them too,
- if no e-mail is sent from the domain, publish two records so that nobody can send mail in its name: `@  TXT  "v=spf1 -all"` and `_dmarc  TXT  "v=DMARC1; p=reject"`.

HSTS is sent without `preload`. The preload list can hardly be left again and would bind every subdomain to HTTPS; it only makes sense for a domain used for nothing else.

## Legal pages

Vercel processes the visitors' IP addresses (see the privacy policy). The GDPR then asks for a data processing agreement (Art. 28 GDPR) with Vercel.

**Vercel's DPA only covers the Pro and Enterprise plans, not the free Hobby plan.** Its introduction says: "This Addendum applies to Vercel's Processing of Personal Data as a Processor under the Agreement for Customers who are on Enterprise and Pro plans." On those plans it needs no signature: it "shall become legally binding upon Customer entering into the Agreement", and the standard contractual clauses in it count as signed. On the Hobby plan there is no such agreement, and the privacy policy must not claim one. (Checked in November 2026 against the [DPA](https://vercel.com/legal/dpa) of 17 March 2026 and the [Terms of Service](https://vercel.com/legal/terms) of 19 October 2026.)

`LEGAL_HOSTING_DPA` decides which text the privacy policy shows: with `true` it says that the host processes the data under a contract according to Art. 28 GDPR, without it that the host handles the data under its own privacy policy. On the Hobby plan this is legally not fully clean, since the agreement is missing; for a private project without cookies, tracking or content from other servers the risk is small. The Pro plan closes the gap.

Values for Vercel:

| Variable | Hobby | Pro |
| --- | --- | --- |
| `LEGAL_HOSTING` | `Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA` | the same |
| `LEGAL_HOSTING_DPA` | empty | `true` |
| `LEGAL_HOSTING_TRANSFER` | `Vercel Inc. is certified under the EU-U.S. Data Privacy Framework (Art. 45 GDPR).` | the same, plus: `In addition, the contract with Vercel contains the standard contractual clauses of the European Commission (Art. 46 (2) (c) GDPR).` |

The address is the one the DPA gives for Vercel Inc. Vercel states that it is certified under the EU-U.S. Data Privacy Framework; check the entry in the [official list](https://www.dataprivacyframework.gov/list) before going live.

Also before going live:

- on the Hobby and trial plans Vercel may use the content of a project to train AI models; switch that off in the team and project settings,
- set `LEGAL_LOG_DAYS` to how long Vercel keeps the logs on your plan, or leave it empty,
- set `LEGAL_EMAIL_PROVIDER` if a mail provider receives the e-mails to `LEGAL_EMAIL`,
- if the database runs at another company, check whether the privacy policy has to name it as well: the search terms pass through it,
- leave Vercel's bot protection and attack challenge mode off, or update the privacy policy: they can set cookies, and the policy says there are none.

The legal pages are a careful draft, not legal advice.
