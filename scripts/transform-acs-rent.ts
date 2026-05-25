/**
 * Transform a manually downloaded Census ACS rent CSV into the admin upload shape:
 *   year,geo_level,geo_id,median_gross_rent_cents,sample_size
 *
 * Default scope is launch-market ZCTAs from src/lib/shared/top-cities.ts.
 *
 * Usage:
 *   bun run scripts/transform-acs-rent.ts raw-acs.csv output/acs-launch.csv --year=2024 --source-url=https://data.census.gov/...
 *   bun run scripts/transform-acs-rent.ts raw-acs.csv output/acs-all.csv --year=2024 --all-zctas
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse } from 'csv-parse/sync';
import { TOP_CITIES } from '../src/lib/shared/top-cities';

interface Args {
	inputPath: string;
	outputPath: string;
	year: number;
	sourceUrl: string | null;
	notes: string | null;
	allZctas: boolean;
}

type RawRecord = Record<string, string>;

const launchZctas = new Set(TOP_CITIES.flatMap((city) => city.zips));

function usage(): never {
	throw new Error(
		[
			'Usage:',
			'  bun run scripts/transform-acs-rent.ts <raw-acs.csv> <normalized-output.csv> --year=YYYY [--source-url=URL] [--notes=TEXT] [--all-zctas]',
			'',
			'Expected raw columns include ACS B25064_001E (median gross rent dollars), B25001_001E (housing units), and a ZCTA/geography column.'
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
	const yearRaw = flags.get('year');
	const year = Number(yearRaw);
	if (!Number.isInteger(year) || year < 2000 || year > new Date().getUTCFullYear() + 1) {
		usage();
	}
	const sourceUrl = flags.get('source-url');
	const notes = flags.get('notes');
	return {
		inputPath: positional[0],
		outputPath: positional[1],
		year,
		sourceUrl: typeof sourceUrl === 'string' ? sourceUrl : null,
		notes: typeof notes === 'string' ? notes : null,
		allZctas: flags.has('all-zctas')
	};
}

function normHeader(h: string): string {
	return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function pickColumn(headers: string[], candidates: Array<string | RegExp>, label: string): string {
	for (const candidate of candidates) {
		const found = headers.find((h) =>
			typeof candidate === 'string'
				? normHeader(h) === normHeader(candidate)
				: candidate.test(normHeader(h))
		);
		if (found) return found;
	}
	throw new Error(`Could not find ${label} column. Headers: ${headers.join(', ')}`);
}

function zctaFromRecord(value: string): string | null {
	const digits = value.match(/\d{5}/)?.[0] ?? '';
	return digits.length === 5 ? digits : null;
}

function positiveNumber(raw: string): number | null {
	const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''));
	return Number.isFinite(n) && n > 0 ? n : null;
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

if (records.length === 0) {
	throw new Error('Raw ACS CSV has no data rows.');
}

const headers = Object.keys(records[0]);
const rentColumn = pickColumn(
	headers,
	[
		'B25064_001E',
		/B25064_001E/i,
		/median gross rent/,
		/estimate.*median.*gross.*rent/
	],
	'ACS median gross rent (B25064_001E)'
);
const sampleColumn = pickColumn(
	headers,
	['B25001_001E', /B25001_001E/i, /total housing units/, /estimate.*total.*housing/],
	'ACS housing units sample size (B25001_001E)'
);
const zctaColumn = pickColumn(
	headers,
	[
		'zip code tabulation area',
		'zcta',
		'geo_id',
		'geoid',
		/geographic.*identifier/,
		/geography/,
		/zip code tabulation area/,
		/zcta/
	],
	'ZCTA/geography'
);

const output = [toLine(['year', 'geo_level', 'geo_id', 'median_gross_rent_cents', 'sample_size'])];
let skippedMissing = 0;
let skippedOutsideScope = 0;
const seen = new Set<string>();

for (const record of records) {
	const zcta = zctaFromRecord(record[zctaColumn]);
	if (!zcta) {
		skippedMissing += 1;
		continue;
	}
	if (!args.allZctas && !launchZctas.has(zcta)) {
		skippedOutsideScope += 1;
		continue;
	}
	const rentDollars = positiveNumber(record[rentColumn]);
	if (!rentDollars) {
		skippedMissing += 1;
		continue;
	}
	const sampleSize = positiveNumber(record[sampleColumn]);
	const key = `${args.year}|zcta|${zcta}`;
	if (seen.has(key)) continue;
	seen.add(key);
	output.push(
		toLine([
			args.year,
			'zcta',
			zcta,
			Math.round(rentDollars * 100),
			sampleSize ? Math.round(sampleSize) : ''
		])
	);
}

mkdirSync(dirname(args.outputPath), { recursive: true });
writeFileSync(args.outputPath, output.join('\n') + '\n');

const manifest = {
	kind: 'acs_rent',
	generatedAt: new Date().toISOString(),
	sourceUrl: args.sourceUrl,
	sourcePath: args.inputPath,
	sourceSha256: rawSha256,
	dataYear: args.year,
	scope: args.allZctas ? 'all_zctas_in_file' : 'launch_market_zctas',
	launchMarketCount: TOP_CITIES.length,
	inputRows: records.length,
	outputRows: output.length - 1,
	skippedMissing,
	skippedOutsideScope,
	columns: {
		zcta: zctaColumn,
		medianGrossRentDollars: rentColumn,
		sampleSize: sampleColumn
	},
	notes: args.notes
};
writeFileSync(`${args.outputPath}.manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

// eslint-disable-next-line no-console
console.log(
	`Wrote ${output.length - 1} ACS rows to ${args.outputPath} and ${args.outputPath}.manifest.json`
);
