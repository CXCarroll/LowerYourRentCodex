# Lower Your Rent

SvelteKit application managed with Bun.

## Setup

Install dependencies from the lockfile before running tests, checks, or the dev server:

```sh
bun install --frozen-lockfile
```

This installs the runtime and tooling modules required by the app, including `csv-parse`, `parse-address`, `drizzle-orm`, `@sveltejs/kit`, and `svelte-check`.

## Development

```sh
bun run dev
```

## Verification

```sh
bun test
bun run check
```

## Cost estimation

To estimate the monthly Railway and vendor cost for 10,000 completed negotiation flows, follow `docs/railway-cost-estimation.md` and run:

```sh
bun run cost:estimate samples/railway-cost-measurement.example.json
```

For a clean-room dependency verification, remove generated install artifacts first:

```sh
rm -rf node_modules .svelte-kit
bun install --frozen-lockfile
bun test
bun run check
```

## Building

To create a production version of your app:

```sh
bun run build
```

You can preview the production build with:

```sh
bun run preview
```
