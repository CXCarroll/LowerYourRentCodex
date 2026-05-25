# Seed Data Acquisition

Production seed data is acquired outside Railway, then uploaded through `/admin`.
Railway-hosted downloads are convenience tools only; do not depend on them for initial seeding.

## Sources

- ACS median rent: Census ACS 5-year table `B25064_001E` and housing units `B25001_001E`.
  Use official Census/data.census.gov exports.
- HUD FMR: HUD USER Fair Market Rent files.
- Vacancy: Census Housing Vacancy Survey rental vacancy rates.
- Do not use mirrors or commercial sources for v1 unless the source policy changes.

## Workflow

1. Download raw official files from a normal browser.
2. Save each raw file with a sidecar manifest containing source URL, download date, data year,
   checksum, and operator notes.
3. Transform raw files into normalized CSVs scoped to launch markets.
4. Upload through `/admin/upload/acs`, `/admin/upload/fmr`, and `/admin/upload/vacancy`.
5. Review dry-run row counts, inserts, updates, errors, warnings, and sample rows before commit.
6. Spot-check `/admin/explore` for launch ZIPs and confirm ACS, FMR, and vacancy data appear.

## ACS Transform

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

```csv
year,county_fips,apt_type,fmr_cents
2026,36047,1br,240000
```

`apt_type` must be one of `studio`, `1br`, `2br`, `3br`, or `4br_plus`.

## Vacancy Upload Shape

```csv
year,quarter,cbsa_code,rental_vacancy_pct
2024,4,35620,5.20
```
