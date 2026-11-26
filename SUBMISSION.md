# SUBMISSION — P26 · Status page + uptime monitoring

Stare la commit-ul `c7a5114` (26.11.2026). Toate dovezile de mai jos sunt fișiere, teste,
endpoint-uri sau commit-uri din acest repo; unde nu există dovadă, rândul spune asta.

## Linkuri

| Ce | Valoare |
|---|---|
| URL live | **Nu există încă.** Niciun deploy nu a rulat: job-ul `deploy` din CI este sărit pentru că secretele mediului `production` lipsesc (ultima rulare: GitHub Actions run `45898872093`, notice „Deploy skipped: missing secrets in the production environment”). După configurare, pagina publică va fi la `https://<DOMAIN>/status` (README.md → Deploy). |
| Repo | https://github.com/laurentiuconstantinpantaleru-cyber/status-page-uptime-monitoring |
| CI | `.github/workflows/ci.yml`; rularea `45898872093` pe `36dc73c`: `lint-and-test` success, `image` success, `deploy` skipped |

## Conturi de test

**Nu există conturi pe live**, pentru că nu există live. Conturile se creează din linia de
comandă (D-034), cu parola citită din stdin, niciodată din argumente:

```bash
npm run user:create -- --email <email> --name "<nume>" --role member --org <slug>
npm run user:create -- --email <email> --name "<nume>" --role org_admin --org <slug>
npm run user:create -- --email <email> --name "<nume>" --role global_admin
```

Cheile API se creează la fel: `npm run apikey:create -- --org <slug> --name "<nume>" --level read|write` (cheia se afișează o singură dată). Contactele de alertă: `npm run contact:add -- --org <slug> --name "<nume>" --channel email|telegram --address <adresă sau chat id> --priority primary|secondary`. Parolele și cheile nu se scriu în repo.

## Cum rulez local

Cerințe: Node.js 22+, Docker.

```bash
npm install
cp .env.example .env            # completează MYSQL_* și DATABASE_URL (port 3307)
docker compose up -d            # MySQL 8.4 pe 127.0.0.1:3307
npm run build
npm run db:migrate              # aplică db/migrations/, inclusiv cele 2 monitoare cu acord
npm run user:create -- --email admin@example.test --name "Admin" --role global_admin
npm run start:web               # http://localhost:3000/status, /login, /admin, /api/v1, /docs
WORKER_NAME=worker-1 npm run start:worker
WORKER_NAME=worker-2 npm run start:worker
```

Rapoartele lunare și alertele pe email pleacă doar cu `SMTP_URL` și `MAIL_FROM` setate, alertele pe
Telegram doar cu `TELEGRAM_BOT_TOKEN`, iar linkurile de confirmare au nevoie de `PUBLIC_URL`
(`.env.example`). Fără ele, canalul respectiv așteaptă; rapoartele se pot descărca din `/admin/reports`.

## Comanda de teste

```bash
npm test                                   # 580 de teste; cele MySQL (58) sunt sărite fără bază
npm run lint                               # tsc --noEmit + ledger-lint.py
```

Cu testele MySQL (o bază de aruncat, cu numele terminat în `_test`):

```bash
docker run -d --rm --name uptime-schema-test -e MYSQL_ROOT_PASSWORD=change-me \
  -e MYSQL_DATABASE=uptime_test -p 127.0.0.1:3308:3306 mysql:8.4
TEST_DATABASE_URL=mysql://root:change-me@localhost:3308/uptime_test npm test   # 638 de teste
```

## Clienții reali

Detaliile sunt în `INTERVIEW.md`, `MONITORS.md` și `docs/survey-results.md`.

- **Firme locale (2/2, acord la telefon pe 25.11.2026):** Hug The Mug (`https://hugthemug.ro/`)
  și Cafe Wien Sibiu (`http://cafewien.ro/`). Ambele sunt în `db/migrations/0002_seed_local_businesses.sql`,
  la 5 minute.
- **Proprietari de aplicații (colegi):** un formular online cu 10 întrebări, 4 respondenți
  (`INTERVIEW.md`). Este un formular, nu 3 interviuri față în față.
- **Proiecte ale colegilor:** 3 din 10 confirmate (`MONITORS.md`, „Student Projects (3/10
  Confirmed — In Progress)”), în migrarea `db/migrations/0011_seed_student_projects.sql`.

## Variabilele mele

| Variabilă | Valoare | Unde e decisă | Unde e în cod / starea |
|---|---|---|---|
| N (eșecuri confirmate până la incident) | 2 | D-006, `docs/agents/decisions/incidents.md:3` | `src/shared/incidents.ts:4` (`OPEN_AFTER = 2`); test `test/shared/incidents.test.ts:39` „uses N = 2 and M = 2” |
| M (succese până la închidere) | 2 | D-006, `docs/agents/decisions/incidents.md:3` | `src/shared/incidents.ts:6` (`CLOSE_AFTER = 2`); test `test/shared/incidents.test.ts:67` „resolves after 2 consecutive successes” |
| Avertizare TLS | 30 de zile (și 7) | D-010, `docs/agents/decisions/monitoring.md:13` | **PARTIAL:** zilele rămase se calculează la fiecare check (`src/worker/check.ts:73`, test `test/worker/check.test.ts:85`), dar avertizarea nu se trimite: dispecerul de alerte există (D-044), avertizările TLS au un plan separat, neconstruit |
| Interval implicit | 5 minute (1–60) | D-016, `docs/agents/decisions/monitoring.md:3` | `db/migrations/0001_initial_schema.sql:35` (`DEFAULT 5`), `:46` (`CHECK 1–60`); API: `src/web/api/monitor-input.ts` (implicit 5) |
| Date brute | 7 zile, apoi roll-up orar / zilnic | D-011, `docs/agents/decisions/monitoring.md:23` | **PARTIAL:** jobul de retenție și roll-up nu există; azi niciun check nu se șterge. Q-023 (`docs/agents/questions/monitoring.md`) leagă roll-up-ul de raportul lunar |
| Escaladare | al doilea contact după 15 min fără confirmare (configurabil până la 60, per organizație) | D-007, `docs/agents/decisions/incidents.md:13`; D-044 | `src/shared/alerts.ts:35` (`dueKinds`); test `test/web/alerts.test.ts:147` „escalates to the secondary contacts 15 minutes after the primary alert, once; acknowledged in time, it does not”; confirmarea: `test/web/ack.test.ts:33`; commit-uri `94ff6c9`, `c7a5114` |

## Self-check — Definition of Done (brief)

| # | Cerință | Stare | Dovadă |
|---|---|---|---|
| 1 | Minim 12 monitoare reale rulează pe live de minim 14 zile; status page-ul public e accesibil | **PARTIAL** | Nu există live (vezi „URL live”). `MONITORS.md`: 5 din 12 monitoare au acord (`db/migrations/0002_seed_local_businesses.sql`, `0011_seed_student_projects.sql`). Pagina publică merge local: `GET /status` (`src/web/app.ts`, test `test/web/status-page.test.ts:114` „shows the 90- and 30-day uptime of each component…”), commit `1d7b4ac` |
| 2 | Un incident real (sau provocat) detectat, alertat pe Telegram și închis automat | **PARTIAL** | Detectarea și închiderea automată: `test/worker/worker.test.ts:102` „opens an incident after 2 confirmed failures and resolves it after 2 successes”, commit `476f3a3`. Alertarea pe email și Telegram, o dată la deschidere și o dată la rezolvare: `test/web/alerts.test.ts:113`, `:131`, `:187`; cererea `sendMessage`: `test/web/telegram.test.ts:19`; commit `94ff6c9`. **Lipsește dovada reală:** nu există live și Telegram nu a fost apelat cu un bot real, deci niciun incident real nu a fost alertat |
| 3 | Calculul de uptime cu mentenanță și incidente peste granița lunii are minim 5 teste | **OK** | `test/shared/uptime.test.ts`: 12 teste `uptime`, între care `:30` „counts for November only the part of a crossing incident outside maintenance: (719 - 1) / 719”, `:37` (aceeași întâmplare pe octombrie), `:44`, `:55`, `:67` (mentenanță suprapusă), `:81` (fereastră recurentă peste miezul nopții), `:159` (30 de zile peste granița lunii). Cod: `src/shared/uptime.ts`, commit `40da385` |
| 4 | Scheduler-ul nu driftează și nu suprapune (test cu timp simulat) | **OK** | `test/worker/scheduler.test.ts:41` „runs a 1-minute monitor exactly 60 times in an hour”, `:51` „keeps every start on the grid when checks take 40 seconds”, `:61` „skips a slot while the previous check of the monitor still runs”, `:86` „runs 300 1-minute monitors 60 times each in an hour…”. `FakeClock` în `src/shared/clock.ts` (PATTERN-001), commit `476f3a3` |
| 5 | Colegii intervievați au cerut ceva ce ai implementat (DECISIONS.md) | **OK, cu o rezervă** | Formularul (4 respondenți, `docs/survey-results.md`), nu 3 interviuri: <br>• închidere după 2–3 succese (3 din 4) și deschidere după 2 eșecuri (2 din 4) → D-006 (`docs/agents/decisions/incidents.md:3`, dovada `docs/survey-results.md:7`, `:12`), test `test/worker/worker.test.ts:102`; <br>• statusuri scrise de om pe etape (3 din 4) → D-014 (`incidents.md:43`, `docs/survey-results.md:14`), `POST /admin/incidents/:id/updates`, test `test/web/admin-incidents.test.ts:98`, commit `d76523a`; <br>• buton rapid 15/30/60 min (2 din 4) → D-012 (`incidents.md:23`, `docs/survey-results.md:16`), `POST /admin/monitors/:id/maintenance`, test `test/web/admin-monitors.test.ts:110` |

Și Definition of Done din `AGENTS.md`:

| # | Cerință | Stare | Dovadă |
|---|---|---|---|
| 6 | `npm test` trece, inclusiv testele cu timp simulat | **OK** | CI run `45898872093` pe `36dc73c`, job `lint-and-test` success (CI rulează și testele MySQL) |
| 7 | `ledger-lint.py` trece fără erori | **OK** | același job: `npm run lint` rulează `python3 docs/agents/tools/ledger-lint.py` |

## Ce nu am terminat și de ce

- **Deploy și URL live.** Infrastructura e scrisă (`deploy/compose.prod.yml`, `deploy/Caddyfile`,
  job-ul `deploy` din `.github/workflows/ci.yml`), dar serverul și secretele mediului `production` nu
  sunt configurate, așa că job-ul e sărit. Fără live nu pot exista nici cele 14 zile de monitorizare.
- **10 proiecte ale colegilor.** 3 din 10 au acord și sunt în migrări; restul de 7 lipsesc (`MONITORS.md`).
- **Alerte reale pe Telegram și email.** Dispecerul, escaladarea și confirmarea sunt construite și
  testate cu clienți falși (D-044), dar fără live, fără bot Telegram (`TELEGRAM_BOT_TOKEN`) și fără
  SMTP configurat nu a plecat nicio alertă reală.
- **Avertizările de expirare TLS (D-010).** Zilele rămase se calculează, dar trimiterea are un plan
  separat, neconstruit încă.
- **Retenția de 7 zile și roll-up-ul orar / zilnic.** Jobul nu e construit (D-011). Graficele pe
  90 de zile nu citesc agregate: pagina publică calculează uptime-ul din incidente. Q-023 e deschisă.
- **Graficul de timp de răspuns pe pagina publică.** Nu e construit: Q-012 (perioada și monitorul
  afișat) are un răspuns propus, dar e încă `investigating`, fără confirmare.
- **Adăugare / editare de monitoare din dashboard.** Butoanele sunt dezactivate, „coming soon” (D-037);
  crearea merge prin API (`POST /api/v1/monitors`, C-004).
- **Mentenanță programată din interfață.** Regulile recurente și ferestrele unice sunt în store și
  testate (`src/web/maintenance/store.ts`, D-031), dar doar butonul rapid are rută.
- **Contacte de alertă și chei API din interfață.** Se creează doar din CLI (`npm run contact:add`,
  `npm run apikey:create`); revocarea unei chei se face direct în SQL (`api_keys.revoked_at`).

## Cum verifici twist-ul în 2 minute

```bash
npm install
npx vitest run test/shared/uptime.test.ts test/shared/incidents.test.ts \
  test/shared/worker-fault.test.ts test/worker/worker.test.ts test/worker/scheduler.test.ts
```

64 de teste, sub 2 secunde, fără bază de date și fără `sleep`: timpul vine din `FakeClock`.

1. **Uptime-ul din incidente, peste granița lunii, cu mentenanță parțială.** `test/shared/uptime.test.ts:30`
   este exact exemplul din brief: incident 31 oct 23:00 → 1 nov 02:00, mentenanță 1 nov 00:00 → 01:00.
   Noiembrie are 720 h, din care 1 h de mentenanță, deci 719 h numărate. Din incident, în noiembrie
   rămâne doar 01:00–02:00 în afara mentenanței, adică 1 h de downtime. Uptime = 718 / 719 = 99.86 %.
   Testul de la `:37` arată aceeași întâmplare pe octombrie: 743 / 744. Formula e în
   `src/shared/uptime.ts` (D-030).
2. **N eșecuri confirmate de al doilea worker, M succese.** `test/shared/incidents.test.ts:44`
   „opens after 2 consecutive failures confirmed by the other worker”, `:56` „does not open when a failure
   is not confirmed”, `:67`, `:73`. Cap-coadă, cu doi workeri: `test/worker/worker.test.ts:102`.
3. **Workerul picat, nu site-ul.** `test/shared/worker-fault.test.ts:29` „finds a worker degraded at exactly
   70 % of its checks failed”, `:71` „finds a worker healthy when the other worker also sees the sites down”.
   În worker: `test/worker/worker.test.ts:245` „opens no incident from the confirmations of a degraded
   worker”, `:257`. Regula: D-015, cod `src/shared/worker-fault.ts`, commit `1bfabb0`.
