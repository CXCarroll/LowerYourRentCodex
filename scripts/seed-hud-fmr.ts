/**
 * Seed the `hud_fmr` table from HUD Fair Market Rents XLSX.
 *
 * Run: bun run scripts/seed-hud-fmr.ts
 */

import { sql } from 'drizzle-orm';
import { hudFmr } from '../src/lib/server/db/schema';
import { fetchFmrRows, HUD_FMR_AVAILABLE_YEARS } from '../src/lib/server/admin/hud-files';
import { chunk, getDb, log } from './_seed-helpers';

async function fetchLatestFmrRows() {
	let last: unknown;
	for (const year of [...HUD_FMR_AVAILABLE_YEARS].reverse()) {
		try {
			log('fetch', `loading HUD FMR rows for FY${year}`);
			const rows = await fetchFmrRows(year);
			return { rows, year };
		} catch (err) {
			last = err;
			log('warn', `HUD FMR FY${year} failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	throw last instanceof Error ? last : new Error(String(last));
}

async function main() {
	const { db, close } = getDb();
	try {
		const { rows, year } = await fetchLatestFmrRows();
		log('prep', `ready to upsert ${rows.length} hud_fmr rows for FY${year}`);

		let upserted = 0;
		await chunk(rows, 1000, async (batch) => {
			await db
				.insert(hudFmr)
				.values(batch)
				.onConflictDoUpdate({
					target: [hudFmr.year, hudFmr.countyFips, hudFmr.aptType],
					set: { fmrCents: sql.raw(`excluded.${hudFmr.fmrCents.name}`) }
				});
			upserted += batch.length;
		});
		log('done', `upserted ${upserted} hud_fmr rows`);
	} finally {
		await close();
	}
}

await main();
