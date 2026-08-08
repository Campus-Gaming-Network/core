# 09 — School data (College Scorecard)

One-time bootstrap of the US school catalog from the Department of Education [College Scorecard](https://collegescorecard.ed.gov/data/).

**This seed runs once.** After the initial import, routine school create / edit / delete happens through later admin tooling / **CRM**. Do not re-import Scorecard on a schedule.

## Files

| File | Role | Git? |
|------|------|------|
| `data/Schools_2025_26.csv` | Raw Scorecard institution extract (~60MB, 3308 columns, 6273 rows) | **Ignored** (too large) |
| `data/schools_seed.csv` | Slim seed for the one-time import (12 columns, 6243 operating schools) | **Tracked** |
| `scripts/build_schools_seed.py` | Builds the seed CSV from the raw download (dev utility only) | Tracked |

```bash
# Only needed if regenerating the seed file before the first import:
python3 scripts/build_schools_seed.py
```

## What we keep from Scorecard

Identity and location only (no public/private/nonprofit classification).

| Seed column | Scorecard field | Notes |
|-------------|-----------------|-------|
| `unitid` | `UNITID` | Optional in DB; set on seeded rows; unique when present |
| `name` | `INSTNM` | Display name (not unique) |
| `alias` | `ALIAS` | Optional short name |
| `slug` | derived | URL slug; collisions get `-2`, `-3`, … |
| `city` / `state` / `zip` | `CITY` / `STABBR` / `ZIP` | |
| `website_url` | `INSTURL` | Normalized with `https://` when missing |
| `latitude` / `longitude` | `LATITUDE` / `LONGITUDE` | Stored now; near-you feature is later |
| `is_main_campus` | `MAIN` | `1` = main |
| `num_branches` | `NUMBRANCH` | |

**Filter applied:** `CURROPER = 1` (currently operating). Closed schools are dropped from the seed (30 rows in this file).

## Counts (this extract)

| Set | Count |
|-----|------:|
| Raw rows | 6,273 |
| Operating (`CURROPER=1`) in seed | 6,243 |
| Main campuses | 4,943 |
| **Branch campuses** | **1,300** |
| With lat/lng | 5,715 |
| Distinct `STABBR` values | 59 (states + DC + territories) |

## Lifecycle

```text
Scorecard CSV  →  schools_seed.csv  →  one-time DB import (ALL rows, is_active=true)
                                              │
                                              ▼
                                    admin tooling / CRM owns the catalog
                         (create · edit · soft-delete · logos · admins · review)
```

1. **One-time import** loads **all** `data/schools_seed.csv` rows (main + branch) with `is_active=true`.
2. Branch campuses use the same browse/detail UI as other schools; no special branch-campus UX for now.
3. Review/deactivate bad or unwanted schools later in CRM/admin tooling — do not filter at import time.
4. **CRM/admin tooling** later becomes the routine way to add schools, edit fields, upload logos, activate/deactivate, assign admins, or soft-delete.
5. Users **cannot** create schools.
6. School **names are not unique**; **slugs are unique**.
7. **`unitid` is optional** in the schema (unique when present). Seeded rows have it; admin/CRM-created schools may omit it.
8. No yearly Scorecard sync.

## Schema impact (`schools`)

```text
schools
  id
  unitid          -- optional, unique when present
  name            -- not unique
  alias
  slug            -- unique
  city, state, zip
  website_url
  logo_url        -- NOT from Scorecard; later CRM/admin-only upload (PNG/JPG ≤500 MB)
  latitude, longitude
  is_main_campus
  num_branches
  is_active       -- true on seed import; CRM/admin tooling can deactivate later
  created_at, updated_at, deleted_at
```

Logos are **not** in Scorecard and **cannot** be uploaded from the main site. Placeholder for now; later a site admin can set one in the CRM/admin app.

## One-time import (implemented)

The Go seed command reads `data/schools_seed.csv`, validates every row, and inserts the full catalog transactionally:

```bash
cd apps/api
go run ./cmd/seed -csv ../../data/schools_seed.csv
```

1. The command inserts **all** rows as `is_active=true` (unique on `unitid` when present and on `slug`).
2. It is idempotent when the table already contains exactly the seed row count and refuses any other non-empty catalog, preventing an accidental recurring sync.
3. Local Docker Compose runs it after migrations. Railway production runs it once during bootstrap, without development-user environment variables.
4. After success, day-to-day changes are later CRM/admin-tooling only — do not re-run it as a scheduled production job.

## Known gaps in this download

- **No logos / brand colors**
- **Aliases sparse** (~2.3k of 6.2k)
- Territories and non-state `STABBR` values are present — still “US” for launch scope
- Includes 1,300 branch campuses and many non-traditional schools; branch campuses use the same UI/UX, and cleanup can happen via CRM/admin tooling over time

## References

- [College Scorecard data page](https://collegescorecard.ed.gov/data/)
- [Institution data documentation (PDF)](https://collegescorecard.ed.gov/assets/InstitutionDataDocumentation.pdf)
- Data dictionary (XLSX) linked from the Scorecard data page
