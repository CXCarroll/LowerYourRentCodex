/**
 * Transform ACS 5-year PUMS housing CSV into the admin ACS upload shape:
 *   year,geo_level,geo_id,median_gross_rent_cents,sample_size
 *
 * Rows represent weighted median gross rent among renter households that moved
 * into the unit within the last 12 months, grouped by state+PUMA.
 *
 * Usage:
 *   bun run scripts/transform-acs-pums-recent-mover-rent.ts raw-pums-h.csv output/acs-pums-recent-mover.csv --year=2024
 *   bun run scripts/transform-acs-pums-recent-mover-rent.ts raw-pums-h.csv output/acs-pums-recent-mover.csv --year=2024 --min-sample-size=50 --source-url=https://api.census.gov/...
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse } from 'csv-parse/sync';
import { transformPumsRecentMoverRent } from './pums-recent-mover-rent-lib';

interface Args {
	inputPath: string;
	outputPath: string;
	year: number;
	minSampleSize: number;
	sourceUrl: string | null;
	notes: string | null;
}

type RawRecord = Record<string, string>;

function usage(): never {
	throw new Error(
		[
			'Usage:',
			'  bun run scripts/transform-acs-pums-recent-mover-rent.ts <raw-pums-h.csv> <normalized-output.csv> --year=YYYY [--min-sample-size=30] [--source-url=URL] [--notes=TEXT]',
			'',
			'Expected raw columns include STATE or ST, PUMA, TEN, MV, GRNTP, WGTP, and ADJHSG.'
		].join('\n')
	);
}

function parseArgs(argv: string[]): Args {
	const positional: string[] = [];
	const flags = new Map<string, string | boolean>();
	for (const arg of argv) {
		if (!arg.startsWith('--')) {
			positional.push(arg);
			continue;
		}
		const [name, ...rest] = arg.slice(2).split('=');
		flags.set(name, rest.length > 0 ? rest.join('=') : true);
	}
	if (positional.length !== 2) usage();
	const year = Number(flags.get('year'));
	if (!Number.isInteger(year) || year < 2000 || year > new Date().getUTCFullYear() + 1) {
		usage();
	}
	const minSampleSizeRaw = flags.get('min-sample-size') ?? '30';
	const minSampleSize = Number(minSampleSizeRaw);
	if (!Number.isInteger(minSampleSize) || minSampleSize < 1) usage();
	const sourceUrl = flags.get('source-url');
	const notes = flags.get('notes');
	return {
		inputPath: positional[0],
		outputPath: positional[1],
		year,
		minSampleSize,
		sourceUrl: typeof sourceUrl === 'string' ? sourceUrl : null,
		notes: typeof notes === 'string' ? notes : null
	};
}

function csvEscape(value: string | number): string {
	const s = String(value);
	if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
	return s;
}

function toLine(cells: Array<string | number>): string {
	return cells.map(csvEscape).join(',');
}

const args = parseArgs(process.argv.slice(2));
const rawBytes = readFileSync(args.inputPath);
const rawSha256 = createHash('sha256').update(rawBytes).digest('hex');
const rawText = rawBytes.toString('utf8').replace(/^\uFEFF/, '');
const records = parse(rawText, {
	columns: true,
	skip_empty_lines: true,
	trim: true
}) as RawRecord[];

const result = transformPumsRecentMoverRent(records, {
	year: args.year,
	minSampleSize: args.minSampleSize
});

const output = [toLine(['year', 'geo_level', 'geo_id', 'median_gross_rent_cents', 'sample_size'])];
for (const row of result.rows) {
	output.push(
		toLine([
			row.year,
			row.geoLevel,
			row.geoId,
			row.medianGrossRentCents,
			row.sampleSize
		])
	);
}

mkdirSync(dirname(args.outputPath), { recursive: true });
writeFileSync(args.outputPath, output.join('\n') + '\n');

const manifest = {
	kind: 'acs_rent',
	source: 'acs_pums_recent_mover',
	generatedAt: new Date().toISOString(),
	sourceUrl: args.sourceUrl,
	sourcePath: args.inputPath,
	sourceSha256: rawSha256,
	dataYear: args.year,
	geography: 'puma',
	filters: {
		TEN: '3 rented',
		MV: '1 moved in within last 12 months',
		GRNTP: '> 0',
		WGTP: '> 0'
	},
	adjustment: 'GRNTP * ADJHSG / 1000000',
	minSampleSize: args.minSampleSize,
	inputRows: result.inputRows,
	qualifiedRows: result.qualifiedRows,
	outputRows: result.outputRows,
	skippedInvalidGeoRows: result.skippedInvalidGeoRows,
	skippedNotRecentRenterRows: result.skippedNotRecentRenterRows,
	skippedInvalidRentRows: result.skippedInvalidRentRows,
	skippedInvalidWeightRows: result.skippedInvalidWeightRows,
	skippedBelowSampleThresholdGroups: result.skippedBelowSampleThresholdGroups,
	columns: {
		state: 'STATE or ST',
		puma: 'PUMA',
		tenure: 'TEN',
		movedIn: 'MV',
		grossRent: 'GRNTP',
		weight: 'WGTP',
		housingAdjustment: 'ADJHSG'
	},
	notes: args.notes
};
writeFileSync(`${args.outputPath}.manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

// eslint-disable-next-line no-console
console.log(
	`Wrote ${result.outputRows} ACS PUMS recent-mover rows to ${args.outputPath} and ${args.outputPath}.manifest.json`
);
