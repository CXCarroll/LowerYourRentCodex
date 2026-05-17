// Pure bucket-fill helpers for dashboard metrics. No DB, no env. Unit-tested.

export interface DailyBucket {
	date: string; // YYYY-MM-DD (UTC)
	count: number;
}
export interface HourlyBucket {
	hour: string; // YYYY-MM-DDTHH:00:00Z (UTC)
	count: number;
}

function toDateKey(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function toHourKey(d: Date): string {
	return d.toISOString().slice(0, 13) + ':00:00Z';
}

/** Zero-fill daily buckets between `start` (inclusive) and `end` (inclusive),
 *  using the provided map of date keys → counts. Start/end are normalized to
 *  UTC midnight of their respective day. */
export function fillDailyBuckets(
	start: Date,
	end: Date,
	counts: Map<string, number>
): DailyBucket[] {
	const out: DailyBucket[] = [];
	const s = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
	const e = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
	for (let t = s.getTime(); t <= e.getTime(); t += 24 * 3600 * 1000) {
		const key = toDateKey(new Date(t));
		out.push({ date: key, count: counts.get(key) ?? 0 });
	}
	return out;
}

/** Zero-fill hourly buckets between `start` (inclusive) and `end` (inclusive).
 *  Start/end are normalized to the top of their respective hour. */
export function fillHourlyBuckets(
	start: Date,
	end: Date,
	counts: Map<string, number>
): HourlyBucket[] {
	const out: HourlyBucket[] = [];
	const s = new Date(
		Date.UTC(
			start.getUTCFullYear(),
			start.getUTCMonth(),
			start.getUTCDate(),
			start.getUTCHours()
		)
	);
	const e = new Date(
		Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), end.getUTCHours())
	);
	for (let t = s.getTime(); t <= e.getTime(); t += 3600 * 1000) {
		const key = toHourKey(new Date(t));
		out.push({ hour: key, count: counts.get(key) ?? 0 });
	}
	return out;
}
