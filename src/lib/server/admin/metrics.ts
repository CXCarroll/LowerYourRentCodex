// Admin dashboard metrics. DB-facing. Pure bucket-fill helpers live in
// `metrics-buckets.ts` and are unit-tested separately.

import { sql } from 'drizzle-orm';
import { assertDb } from '../db/client';
import { submissions } from '../db/schema';
import {
	fillDailyBuckets,
	fillHourlyBuckets,
	type DailyBucket,
	type HourlyBucket
} from './metrics-buckets';

export interface DashboardMetrics {
	total: number;
	last24h: number;
	last7d: number;
	daily: DailyBucket[]; // last 30 days, oldest first
	hourly: HourlyBucket[]; // last 24 h, oldest first
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
	const db = assertDb();

	const [totalsRaw, dailyRaw, hourlyRaw] = await Promise.all([
		db.execute(sql`
			select
				count(*)::int as total,
				count(*) filter (where created_at > now() - interval '1 day')::int as last24h,
				count(*) filter (where created_at > now() - interval '7 days')::int as last7d
			from ${submissions}
		`),
		db.execute(sql`
			select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as d,
				count(*)::int as c
			from ${submissions}
			where created_at > now() - interval '30 days'
			group by 1
			order by 1
		`),
		db.execute(sql`
			select to_char(date_trunc('hour', created_at at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') as h,
				count(*)::int as c
			from ${submissions}
			where created_at > now() - interval '24 hours'
			group by 1
			order by 1
		`)
	]);

	const totalsRows = totalsRaw as unknown as Array<{
		total: number;
		last24h: number;
		last7d: number;
	}>;
	const dailyRows = dailyRaw as unknown as Array<{ d: string; c: number }>;
	const hourlyRows = hourlyRaw as unknown as Array<{ h: string; c: number }>;

	const totals = totalsRows[0] ?? { total: 0, last24h: 0, last7d: 0 };
	const dailyMap = new Map<string, number>();
	for (const row of dailyRows) dailyMap.set(row.d, Number(row.c));
	const hourlyMap = new Map<string, number>();
	for (const row of hourlyRows) hourlyMap.set(row.h, Number(row.c));

	const now = new Date();
	const daily = fillDailyBuckets(
		new Date(now.getTime() - 29 * 24 * 3600 * 1000),
		now,
		dailyMap
	);
	const hourly = fillHourlyBuckets(new Date(now.getTime() - 23 * 3600 * 1000), now, hourlyMap);

	return {
		total: Number(totals.total),
		last24h: Number(totals.last24h),
		last7d: Number(totals.last7d),
		daily,
		hourly
	};
}
