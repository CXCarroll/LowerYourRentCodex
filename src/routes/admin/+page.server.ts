import { sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { assertDb } from '$lib/server/db/client';
import {
	submissions,
	hudFmr,
	acsRent,
	vacancyRates,
	zipCounty,
	adminUploads
} from '$lib/server/db/schema';
import { getDashboardMetrics } from '$lib/server/admin/metrics';

export const load: PageServerLoad = async () => {
	const db = assertDb();
	const [subs, fmr, acs, vac, zc, metrics] = await Promise.all([
		db.select({ n: sql<number>`count(*)::int` }).from(submissions),
		db.select({ n: sql<number>`count(*)::int` }).from(hudFmr),
		db.select({ n: sql<number>`count(*)::int` }).from(acsRent),
		db.select({ n: sql<number>`count(*)::int` }).from(vacancyRates),
		db.select({ n: sql<number>`count(*)::int` }).from(zipCounty),
		getDashboardMetrics()
	]);

	const latestVacancy = await db
		.select({ year: vacancyRates.year, quarter: vacancyRates.quarter })
		.from(vacancyRates)
		.orderBy(sql`year desc, quarter desc`)
		.limit(1);

	const recentUploads = await db
		.select({
			id: adminUploads.id,
			kind: adminUploads.kind,
			filename: adminUploads.filename,
			rowCount: adminUploads.rowCount,
			insertCount: adminUploads.insertCount,
			updateCount: adminUploads.updateCount,
			createdAt: adminUploads.createdAt
		})
		.from(adminUploads)
		.orderBy(sql`created_at desc`)
		.limit(10);

	return {
		counts: {
			submissions: subs[0]?.n ?? 0,
			hud_fmr: fmr[0]?.n ?? 0,
			acs_rent: acs[0]?.n ?? 0,
			vacancy_rates: vac[0]?.n ?? 0,
			zip_county: zc[0]?.n ?? 0
		},
		latestVacancy: latestVacancy[0] ?? null,
		recentUploads,
		metrics
	};
};
