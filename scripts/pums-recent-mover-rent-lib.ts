export interface PumsRecentMoverRow {
	year: number;
	geoLevel: 'puma';
	geoId: string;
	medianGrossRentCents: number;
	sampleSize: number;
}

export interface PumsTransformOptions {
	year: number;
	minSampleSize?: number;
}

export interface PumsTransformStats {
	inputRows: number;
	qualifiedRows: number;
	outputRows: number;
	skippedInvalidGeoRows: number;
	skippedNotRecentRenterRows: number;
	skippedInvalidRentRows: number;
	skippedInvalidWeightRows: number;
	skippedBelowSampleThresholdGroups: number;
}

export interface PumsTransformResult extends PumsTransformStats {
	rows: PumsRecentMoverRow[];
}

type RawRecord = Record<string, string | number | null | undefined>;

interface WeightedRent {
	cents: number;
	weight: number;
}

const DEFAULT_MIN_SAMPLE_SIZE = 30;

function getField(record: RawRecord, names: string[]): string {
	const lower = new Map(Object.entries(record).map(([k, v]) => [k.trim().toUpperCase(), v]));
	for (const name of names) {
		const value = lower.get(name);
		if (value !== undefined && value !== null) return String(value).trim();
	}
	return '';
}

function numberField(record: RawRecord, names: string[]): number | null {
	const raw = getField(record, names).replace(/[$,\s]/g, '');
	if (!raw) return null;
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

function pumaGeoId(record: RawRecord): string | null {
	const stateDigits = getField(record, ['STATE', 'ST']).replace(/\D/g, '');
	const pumaDigits = getField(record, ['PUMA']).replace(/\D/g, '');
	if (!stateDigits || !pumaDigits) return null;
	const state = stateDigits.padStart(2, '0');
	const puma = pumaDigits.padStart(5, '0');
	if (!/^\d{2}$/.test(state) || !/^\d{5}$/.test(puma)) return null;
	return `${state}${puma}`;
}

export function weightedMedianCents(values: WeightedRent[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a.cents - b.cents);
	const totalWeight = sorted.reduce((sum, row) => sum + row.weight, 0);
	if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
	const midpoint = totalWeight / 2;
	let cumulative = 0;
	for (const row of sorted) {
		cumulative += row.weight;
		if (cumulative >= midpoint) return row.cents;
	}
	return sorted[sorted.length - 1].cents;
}

export function transformPumsRecentMoverRent(
	records: RawRecord[],
	options: PumsTransformOptions
): PumsTransformResult {
	const minSampleSize = options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;
	const groups = new Map<string, WeightedRent[]>();
	const stats: PumsTransformStats = {
		inputRows: records.length,
		qualifiedRows: 0,
		outputRows: 0,
		skippedInvalidGeoRows: 0,
		skippedNotRecentRenterRows: 0,
		skippedInvalidRentRows: 0,
		skippedInvalidWeightRows: 0,
		skippedBelowSampleThresholdGroups: 0
	};

	for (const record of records) {
		const geoId = pumaGeoId(record);
		if (!geoId) {
			stats.skippedInvalidGeoRows += 1;
			continue;
		}

		const tenure = numberField(record, ['TEN']);
		const movedIn = numberField(record, ['MV']);
		if (tenure !== 3 || movedIn !== 1) {
			stats.skippedNotRecentRenterRows += 1;
			continue;
		}

		const rentDollars = numberField(record, ['GRNTP']);
		const adjustment = numberField(record, ['ADJHSG']);
		if (
			rentDollars === null ||
			adjustment === null ||
			rentDollars <= 0 ||
			adjustment <= 0
		) {
			stats.skippedInvalidRentRows += 1;
			continue;
		}

		const weight = numberField(record, ['WGTP']);
		if (weight === null || weight <= 0) {
			stats.skippedInvalidWeightRows += 1;
			continue;
		}

		const adjustedRentDollars = (rentDollars * adjustment) / 1_000_000;
		const cents = Math.round(adjustedRentDollars * 100);
		if (!Number.isFinite(cents) || cents <= 0) {
			stats.skippedInvalidRentRows += 1;
			continue;
		}

		const group = groups.get(geoId) ?? [];
		group.push({ cents, weight });
		groups.set(geoId, group);
		stats.qualifiedRows += 1;
	}

	const rows: PumsRecentMoverRow[] = [];
	for (const [geoId, values] of Array.from(groups.entries()).sort((a, b) =>
		a[0].localeCompare(b[0])
	)) {
		if (values.length < minSampleSize) {
			stats.skippedBelowSampleThresholdGroups += 1;
			continue;
		}
		const medianGrossRentCents = weightedMedianCents(values);
		if (medianGrossRentCents === null) continue;
		rows.push({
			year: options.year,
			geoLevel: 'puma',
			geoId,
			medianGrossRentCents,
			sampleSize: values.length
		});
	}

	stats.outputRows = rows.length;
	return { ...stats, rows };
}
