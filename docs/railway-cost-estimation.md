# Railway Cost Estimation

This workflow estimates the monthly cost to serve 10,000 completed negotiation flows on Railway. A completed flow is one tenant going through the public form: app load, optional address autocomplete, `/api/verify/send`, OTP entry, `/api/verify/check`, generated negotiation email, and one submission insert.

Admin dashboard traffic is intentionally ignored. It is expected to be rare and should not materially affect the monthly run-rate.

## 1. Configure The Measurement Window

Deploy the app to Railway with production-equivalent environment variables and Railway Postgres. During the calibration window, set:

```sh
VERIFY_CHECK_TIMING_SAMPLE_RATE=1
```

That makes every `/api/verify/check` response emit `Server-Timing` and every request write a structured `verify_check_timing` log entry. Restore the production sample rate after measurement.

## 2. Capture Inputs

Run at least 100 realistic completed flows. Use addresses that represent expected users and keep Mapbox autocomplete enabled if production will use it.

Record these before/after deltas for the calibration run:

- Completed flow count from the load runner or a direct `submissions` table count.
- Railway app service CPU, memory, and network egress.
- Railway Postgres CPU, memory, storage, and network egress.
- Mapbox Temporary Geocoding request count.
- Resend transactional email count.
- Cloudflare Turnstile challenge or verification count.

Also capture a separate idle baseline by letting the deployed app and database sit idle, preferably for 24 hours, and recording app/Postgres CPU, memory, storage, and egress for that idle period.

Use Railway's per-minute billing units where possible:

- `cpuVcpuMinutes`
- `memoryGbMinutes`
- `egressGb`
- `volumeStorageGbMinutes`

## 3. Prepare The Measurement File

Copy `samples/railway-cost-measurement.example.json` and replace the example values with measured deltas. The estimator scales:

```text
traffic usage = calibration delta / completed flows * 10,000
idle usage = idle baseline / measured idle minutes * 43,200
```

The default scenarios are:

- `low`: no autocomplete, one Mapbox submit-time geocode/check, one email.
- `expected`: observed average Mapbox, Resend, Turnstile, and Railway usage.
- `high`: observed Mapbox unless overridden, two emails per flow for one resend, and observed Railway usage.

For a better high case, set `scenarios.high.mapboxRequestsPerFlow` to the p95 autocomplete request count plus one submit-time address check.

## 4. Run The Estimator

```sh
bun run scripts/estimate-railway-cost.ts samples/railway-cost-measurement.example.json
```

Optionally pass a Railway log export containing `verify_check_timing` lines:

```sh
bun run scripts/estimate-railway-cost.ts measurement.json verify-check.log
```

The report includes low, expected, and high monthly costs with separate rows for Railway app, Railway Postgres, Mapbox, Resend, and Turnstile. The optional log summary reports average, p95, and max timings for spans such as `address_verification`, `geocode`, `zip_lookup`, `negotiation_email_generation`, and `otp_transaction`.

## Pricing Assumptions

Railway pricing uses RAM at `$10/GB-month`, CPU at `$20/vCPU-month`, egress at `$0.05/GB`, and volume storage at `$0.15/GB-month`. Hobby is modeled with a `$5` minimum and Pro with a `$20` minimum, since the subscription counts toward included resource usage.

Mapbox is modeled as Temporary Geocoding with the first 100,000 monthly requests free, then marginal per-1,000 pricing from the public pricing table.

Resend is modeled as transactional email. The estimator picks the cheapest listed plan for the monthly email count; for 10,000 completed flows with one verification email each, that normally means the Pro 50,000-email plan.

Cloudflare Turnstile is modeled as `$0` on the Free plan unless Enterprise is required.

## Caveats

- Railway idle memory can dominate cost at only 10,000 completed flows per month.
- Mapbox cost depends heavily on autocomplete behavior, so use observed request counts instead of guessing when possible.
- Current app timing logs cover `/api/verify/check`; `/api/verify/send` and `/api/address/suggest` are accounted for through Railway/vendor deltas rather than app-level span timings.
- This estimator does not include admin dashboard traffic.
