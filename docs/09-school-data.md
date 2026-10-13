# 09 — School data (College Scorecard)

One-time bootstrap of the US school catalog from the Department of Education [College Scorecard](https://collegescorecard.ed.gov/data/).

**This seed runs once.** After the initial import, routine school create / edit / delete happens through the later **Admin Console**. Do not re-import Scorecard on a schedule.

## Files

| File                            | Role                                                                   | Git?                    |
| ------------------------------- | ---------------------------------------------------------------------- | ----------------------- |
| `data/Schools_2025_26.csv`      | Raw Scorecard institution extract (~60MB, 3308 columns, 6273 rows)     | **Ignored** (too large) |
| `data/schools_seed.csv`         | Slim seed for the one-time import (12 columns, 6243 operating schools) | **Tracked**             |
| `scripts/build_schools_seed.py` | Builds the seed CSV from the raw download (dev utility only)           | Tracked                 |

```bash
# Only needed if regenerating the seed file before the first import:
python3 scripts/build_schools_seed.py
```

## What we keep from Scorecard

Identity and location only (no public/private/nonprofit classification).

| Seed column              | Scorecard field           | Notes                                                   |
| ------------------------ | ------------------------- | ------------------------------------------------------- |
| `unitid`                 | `UNITID`                  | Optional in DB; set on seeded rows; unique when present |
| `name`                   | `INSTNM`                  | Display name (not unique)                               |
| `alias`                  | `ALIAS`                   | Optional names for search; see the note below           |
| `slug`                   | derived                   | URL slug; collisions get `-2`, `-3`, …                  |
| `city` / `state` / `zip` | `CITY` / `STABBR` / `ZIP` |                                                         |
| `website_url`            | `INSTURL`                 | Normalized with `https://` when missing                 |
| `latitude` / `longitude` | `LATITUDE` / `LONGITUDE`  | Stored now; near-you feature is later                   |
| `is_main_campus`         | `MAIN`                    | `1` = main                                              |
| `num_branches`           | `NUMBRANCH`               |                                                         |

**Filter applied:** `CURROPER = 1` (currently operating). Closed schools are dropped from the seed (30 rows in this file).

## Counts (this extract)

| Set                              |                          Count |
| -------------------------------- | -----------------------------: |
| Raw rows                         |                          6,273 |
| Operating (`CURROPER=1`) in seed |                          6,243 |
| Main campuses                    |                          4,943 |
| **Branch campuses**              |                      **1,300** |
| With lat/lng                     |                          5,715 |
| Distinct `STABBR` values         | 59 (states + DC + territories) |

## Lifecycle

```text
Scorecard CSV  →  schools_seed.csv  →  one-time DB import (ALL rows, is_active=true)
                                              │
                                              ▼
                                    Admin Console owns the catalog
                         (create · edit · soft-delete · logos · admins · review)
```

1. **One-time import** loads **all** `data/schools_seed.csv` rows (main + branch) with `is_active=true`.
2. Branch campuses use the same browse/detail UI as other schools; no special branch-campus UX for now.
3. Review/deactivate bad or unwanted schools later in the Admin Console — do not filter at import time.
4. The **Admin Console** later becomes the routine way to add schools, edit fields, upload logos, activate/deactivate, assign admins, or soft-delete.
5. Users **cannot** create schools.
6. School **names are not unique**; **slugs are unique**.
7. **`unitid` is optional** in the schema (unique when present). Seeded rows have it; Admin Console-created schools may omit it.
8. No yearly Scorecard sync.

## Schema impact (`schools`)

```text
schools
  id
  unitid          -- optional, unique when present
  name            -- not unique
  alias           -- search names; may list several
  short_name      -- NOT from Scorecard; Admin Console choice of the name to display
  slug            -- unique
  city, state, zip
  website_url
  logo_url        -- NOT from Scorecard; Admin Console upload override (PNG/JPG ≤5 MB)
  latitude, longitude
  is_main_campus
  num_branches
  is_active       -- true on seed import; Admin Console can deactivate later
  created_at, updated_at, deleted_at
```

Logos are **not** in Scorecard and **cannot** be uploaded from the main site. An approved Admin Console upload takes precedence over the bundled collection described below. Removing an uploaded logo restores the bundled logo when available, otherwise the initial.

## Institutional logos

The main site's home cards, school directory, and school pages use local institutional SVG/PNG/JPG assets in `apps/web/public/school-logos/`. By default they are served from the web app itself and require no third-party image requests or R2 configuration; [they can be served from the logo bucket instead](#serving-bundled-logos-from-r2). The BFF matches the catalog's exact `unitid` and seed `slug`; it never guesses by name or inherits a logo from a main campus. The Go API applies the same rule for the Admin Console: an athletics mark replaces the institutional logo for the same `unitid`, and the seed `slug` must match the entry's. It reads a slim lookup, `apps/api/internal/schools/bundled_logos.json` (`unitid`, `slug`, `asset`, and whether the entry is an athletics mark), embedded in the API because `embed` cannot read `apps/web`. `scripts/collect_school_logos.ts` writes it whenever it writes the manifest, and `--check` fails when it differs from the manifest. The Go test suite, which CI runs, fails the same way. The school details response carries the result as `bundled_logo_url` in the logo bucket, so the Admin Console shows the logo the main site shows for a school without an upload. It shows the school-page logo, including a wide wordmark that small marks on the main site leave out. Unknown or changed identities show the initial. A failed image also reveals the initial after hydration. Most bundled institutional logos are wide wordmarks that are unreadable in a square mark, so a bundled logo wider than 3:2 gets a wider mark on the school page. Small marks (home cards, the directory, and the inline logos below) leave out an institutional logo wider than 3:2 and an athletics mark wider than 2:1, which is usually a picture rather than a line of text; those schools keep the initial or the name alone.

Other places that name a school show the same bundled logo in front of the name: event cards and event pages (the host school), team pages, public profiles (the home school), the account dashboard, and a school's people page. Those API responses carry a school summary with a slug and no `unitid` or `logo_url`, so the BFF matches the seed slug alone, leaves out the same too-wide logos, and does not show an Admin Console upload there. A school without a match shows its name only.

### Serving bundled logos from R2

`pnpm run sync:school-logos` uploads every file listed in the manifest to the school-logo bucket under `bundled/school-logos/`, beside the Admin Console uploads in `school-logos/`. It reads the API's `R2_*` variables, or targets the local Compose object-storage service when neither `R2_ACCOUNT_ID` nor `R2_ENDPOINT` is set. Each file name carries its content hash, so objects are stored once with a one-year immutable cache lifetime; a rerun uploads only new files and never deletes.

Setting `BUNDLED_SCHOOL_LOGOS_IN_R2=true` on the web app makes it link bundled logos at `R2_PUBLIC_ASSET_ORIGIN/bundled/school-logos/…` instead of its own `/school-logos/…`. Run the sync for that environment's bucket first, and again after each new collection, before deploying the web app that references the new manifest. `manifest.json` and `credits.html` are always served by the web app.

The image files are not in git: `.gitignore` leaves out everything in `apps/web/public/school-logos/` except `manifest.json` and `credits.html`, and the bucket is where they are kept. A deployment built from the repository therefore has no local copies and must set `BUNDLED_SCHOOL_LOGOS_IN_R2=true`. On a fresh checkout, `R2_PUBLIC_ASSET_ORIGIN=<bucket's public address> pnpm run sync:school-logos --pull` downloads the missing files and checks each against its manifest checksum; `--check` and a local stack without the switch need them. The browser suites set the switch and use the fake API as the asset origin, so they do not.

`manifest.json` in that directory records each school, Wikidata entity and label, Commons file page, original branding source when provided, author, copyright terms, attribution, restrictions, retrieval date, dimensions, download URL, and SHA-256 checksum. `credits.html` provides public credits and license links, also linked from the logo credit line at the foot of the school page. SVG files retain their original bytes. PNG and JPEG files larger than 640 pixels on their longer side are downscaled when that makes the file smaller, keeping their proportions; the manifest's `resized_from` records the source dimensions, size, and checksum, and the credits page states the change. Third-party assets are excluded from formatting.

The research joins [Wikidata P1771 (IPEDS ID)](https://www.wikidata.org/wiki/Property:P1771) to Scorecard `UNITID`, then selects P154 institutional logos. It prefers SVG and files with official educational branding sources. Candidates with ambiguous identities, unclear copyright terms, unsupported formats, unsuitable variants, external SVG dependencies, or failed downloads are excluded. Only explicitly recorded public-domain, CC0, CC BY, or CC BY-SA terms are accepted; attribution and license links are retained. This is a snapshot with identifier checks and a visual review of the full collection in contact sheets, not a guarantee that every institution's latest rebrand is represented.

Coverage of institutional logos for the October 9, 2026 UTC collection (athletics marks are counted in their own section below):

| Measure                                                  |       Schools |
| -------------------------------------------------------- | ------------: |
| Seed catalog                                             |         6,243 |
| Identifier-matched logo candidates                       |         1,225 |
| Bundled and validated logos                              | 1,118 (17.9%) |
| Candidate schools withheld or rejected                   |           107 |
| Schools without an indexed logo match                    |         5,018 |
| Schools using the initial unless an admin uploads a logo |         5,125 |

The bundle contains 429 SVGs, 624 PNGs, and 65 JPGs, totaling about 31.2 MiB after downscaling. Source terms record 1,030 public-domain files, 9 CC0 files, 11 CC BY files, and 68 CC BY-SA files. The exclusion ledger contains 108 schools: the 107 rejected candidates plus UCF, whose known brand-policy exception is recorded despite having no indexed candidate. Coverage includes only individually matched schools; sharing a system or parent institution does not confer a logo match.

Known brand-policy and rebrand exceptions live in [`data/school-logo-review.json`](../data/school-logo-review.json). The collector applies them to the bundle and records their reasons and sources among the exclusions. ASU, Alabama, and UCLA are withheld pending permission; the indexed UAB artwork predates its 2025 refresh. UCF's current external identity also needs a separately reviewed asset/approval. A second visual review withheld 14 more: marks naming a former identity, files titled as old logos, seals, a flag, parent-institution marks, and variants that are incomplete or unreadable on a light background.

Verified rebrand corrections are recorded separately in [`data/school-logo-overrides.json`](../data/school-logo-overrides.json), with an official identity source. Dallas College uses its unified institutional logo rather than the former El Centro College mark. Middlebury Institute and Pikes Peak State College use verified replacements for their former names. Virginia Wesleyan's current Batten University mark is confirmed against its official history; the older seed name remains a catalog edit for the Admin Console. Other observed name changes without a verified reusable replacement, and a Miami Ad School Europe mark incorrectly indexed to the Miami school, are withheld in the review ledger.

### Athletics marks

Where a school has an athletics program, the site shows the program's mark instead of the institutional logo: athletics marks are compact and stay legible in the small square mark, so they also appear on home cards and in the directory. A program is matched through the institution it represents ([Wikidata P1268](https://www.wikidata.org/wiki/Property:P1268)), itself matched by exact IPEDS ID; a program tied to several catalog schools, or a school with several programs, is skipped. The logo is the one in the program's English Wikipedia infobox, otherwise Wikidata's P154. Only a reduced copy (330 pixels wide, PNG or JPEG) is stored, named `<unitid>-athletics-<hash>`, and listed under `athletics` in the manifest.

The October 9, 2026 collection found 1,350 programs for catalog schools and bundled marks for 1,031 of them; 259 of those schools had no institutional logo, so 1,377 schools (22.1%) now have a logo and 902 of them show it in the directory. 319 programs are listed under `athletics_excluded`, 304 because no logo is recorded. Marks invisible on a white background are rejected automatically. [`data/school-athletics-logo-review.json`](../data/school-athletics-logo-review.json) withholds reviewed mismatches.

**526 of the 1,031 athletics marks are non-free.** They are copyrighted artwork that Wikipedia hosts under its non-free content policy, not under a reuse licence. CGN shows them at reduced size, only to identify the school, with no merchandise or endorsement claim, and relies on fair use for that; this is an accepted risk, not a clearance. The manifest marks each with `non_free`, and the credits page says so. A school that objects is handled by adding it to the review ledger.

Copyright reuse terms do **not** grant institutional trademark permission. The collection is for identifying directory entries, with no endorsement or affiliation claim. Commons itself [requires checking individual terms and other restrictions](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia). Trademark rights and institution-specific permissions still need assessment for CGN's intended public use; the metadata is not legal clearance. An official website offering a download is not by itself a redistribution license.

Maintenance uses Node.js 24 and is explicit, never a scheduled school-data sync:

```bash
node scripts/collect_school_logos.ts --collect
node scripts/collect_school_logos.ts --apply-review
node scripts/collect_school_logos.ts --optimize
node scripts/collect_school_logos.ts --collect-athletics
node scripts/collect_school_logos.ts --check
```

`--collect` fetches source/license metadata and downloads files with bounded concurrency, validates MIME/signatures and source hashes, and writes the bundle and credits. Its temporary download cache supports retrying interrupted research. `--apply-review` removes newly flagged assets without downloading again. `--optimize` downscales large rasters; `--collect` already runs both. `--check` runs offline, first confirms the API's bundled logo lookup matches the manifest, and checks checksums, SVG safety, and actual browser decoding for every bundled image. It requires Playwright Chromium, installed with `pnpm exec playwright install chromium` as for the browser suites. It also fails on a logo that is invisible on white. Add `--preview` to generate contact sheets in the system temporary directory, and `--athletics` to preview the athletics marks. A new logo must pass those checks and have a traceable institution match and reuse terms before inclusion. Routine catalog edits and uploaded-logo overrides remain owned by the Admin Console.

## One-time import (implemented)

The Go seed command reads `data/schools_seed.csv`, validates every row, and inserts the full catalog transactionally:

```bash
cd apps/api
go run ./cmd/seed -csv ../../data/schools_seed.csv
```

1. The command inserts **all** rows as `is_active=true` (unique on `unitid` when present and on `slug`).
2. It is idempotent when the table already contains exactly the seed row count and refuses any other non-empty catalog, preventing an accidental recurring sync.
3. Local Docker Compose runs it after migrations. Railway production runs it once during bootstrap, without development-user environment variables.
4. After success, day-to-day changes happen only through the later Admin Console — do not re-run it as a scheduled production job.

## Known gaps in this download

- **Scorecard has no logos / brand colors**; bundled-logo coverage is separate from this extract.
- **Aliases sparse** (~2.3k of 6.2k), and a search field rather than a display name: a value can list former names, variants, and misspellings separated by `|`, `,`, or `;`. The main site shows the school's `short_name` when an admin has set one in the Admin Console (40 characters at most; not from Scorecard, empty on seeded rows). Otherwise it guesses from the alias: its first acronym (`UIUC`), or the alias itself when it is a single name of 20 characters or fewer. Otherwise it shows no short name
- Territories and non-state `STABBR` values are present — still “US” for launch scope
- Includes 1,300 branch campuses and many non-traditional schools; branch campuses use the same UI/UX, and cleanup can happen through the Admin Console over time

## References

- [College Scorecard data page](https://collegescorecard.ed.gov/data/)
- [Institution data documentation (PDF)](https://collegescorecard.ed.gov/assets/InstitutionDataDocumentation.pdf)
- Data dictionary (XLSX) linked from the Scorecard data page
