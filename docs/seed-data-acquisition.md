# Seed Data Acquisition

Production seed data has two supported paths:

- ACS can be seeded with a manual Railway one-off API job using `CENSUS_API_KEY`.
- ACS, HUD FMR, and vacancy can all be uploaded through `/admin` as normalized CSVs.

Railway-hosted HUD/Census downloads are convenience tools only; do not depend on them for
initial seeding.

## Sources

- ACS median rent: Census ACS 5-year table `B25064_001E` and housing units `B25001_001E`.
  Use official Census/data.census.gov exports.
- HUD FMR: HUD USER Fair Market Rent files.
- Vacancy: Census Housing Vacancy Survey rental vacancy rates.
- Do not use mirrors or commercial sources for v1 unless the source policy changes.

## Workflow

1. Seed ACS with the API-key job, or download raw official ACS files and upload CSV manually.
2. Download raw official HUD FMR and vacancy files from a normal browser.
3. Save each raw file with a sidecar manifest containing source URL, download date, data year,
   checksum, and operator notes.
4. Transform raw files into normalized CSVs.
5. Upload through `/admin/upload/acs`, `/admin/upload/fmr`, and `/admin/upload/vacancy`.
6. Review dry-run row counts, inserts, updates, errors, warnings, and sample rows before commit.
7. Spot-check `/admin/explore` for launch ZIPs and confirm ACS, FMR, and vacancy data appear.

## ACS API-Key Seed

Use this when Railway can reach the Census API and a `CENSUS_API_KEY` is available.
This is a manual one-off job, not part of deploy/startup.

1. Add `CENSUS_API_KEY` to Railway variables.
2. Confirm `DATABASE_URL` is present and migrations have run.
3. Run the one-off seed command from Railway shell/CLI:

```sh
bun run seed:acs:api
```

Optional targeted year:

```sh
ACS_YEAR=2024 bun run seed:acs:api
```

The job fetches nationwide ZCTA rows by default, skips Census negative/missing rent sentinel
values, upserts into `acs_rent`, and logs inserts/updates without printing the API key.

## ACS CSV Upload Fallback

Use this when the API route is blocked or when manually curated seed data is preferred.

Use the helper script for manually downloaded ACS CSVs:

```sh
bun run transform:acs raw-acs.csv output/acs-launch.csv --year=2024 --source-url=https://data.census.gov/...
```

By default, the script keeps only ZCTAs from the app's launch-market top-city list.
Use `--all-zctas` only when intentionally preparing a nationwide file.

The script writes:

- `output/acs-launch.csv`
- `output/acs-launch.csv.manifest.json`

Upload CSV shape:

```csv
year,geo_level,geo_id,median_gross_rent_cents,sample_size
2024,zcta,11201,290000,12500
```

## HUD FMR Upload Shape

HUD FMR should normally be uploaded through `/admin/upload/fmr`. The old HUD download/seed
scripts remain convenience tools, but they are not required for the Railway seed flow.

```csv
year,county_fips,apt_type,fmr_cents
2026,36047,1br,240000
```

`apt_type` must be one of `studio`, `1br`, `2br`, `3br`, or `4br_plus`.

## Vacancy Upload Shape

Vacancy should normally be uploaded through `/admin/upload/vacancy`.

```csv
year,quarter,cbsa_code,rental_vacancy_pct
2024,4,35620,5.20
```
