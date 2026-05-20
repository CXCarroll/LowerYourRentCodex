import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { fail, type Actions } from '@sveltejs/kit';
import { assertDb } from '$lib/server/db/client';
import { vacancyRates, adminUploads } from '$lib/server/db/schema';
import {
	MAX_FILE_BYTES,
	parseVacancyCsv,
	type VacancyRowInput
} from '$lib/server/admin/vacancy-csv';
import {
	consumeStaged,
	stageUpload,
	type StagedVacancyUpload
} from '$lib/server/admin/staging';

const SAMPLE_LIMIT = 10;
const ERROR_DISPLAY_LIMIT = 50;
const WARNING_DISPLAY_LIMIT = 20;

async function diffAgainstDb(rows: VacancyRowInput[]): Promise<{
	insertCount: number;
	updateCount: number;
}> {
	if (rows.length === 0) return { insertCount: 0, updateCount: 0 };
	const db = assertDb();
	// Look up by grouped (year, quarter) then intersect with cbsa set — cheap and correct.
	const byYearQuarter = new Map<string, Set<string>>();
	for (const r of rows) {
		const k = `${r.year}|${r.quarter}`;
		let set = byYearQuarter.get(k);
		if (!set) {
			set = new Set<string>();
			byYearQuarter.set(k, set);
		}
		set.add(r.cbsaCode);
	}
	let updates = 0;
	for (const [k, cbsaSet] of byYearQuarter) {
		const [yearStr, qStr] = k.split('|');
		const year = Number(yearStr);
		const quarter = Number(qStr);
		const cbsas = Array.from(cbsaSet);
		// Chunk to keep parameter counts sane.
		for (let i = 0; i < cbsas.length; i += 5000) {
			const chunk = cbsas.slice(i, i + 5000);
			const existing = await db
				.select({ cbsaCode: vacancyRates.cbsaCode })
				.from(vacancyRates)
				.where(
					and(
						eq(vacancyRates.year, year),
						eq(vacancyRates.quarter, quarter),
						inArray(vacancyRates.cbsaCode, chunk)
					)
				);
			updates += existing.length;
		}
	}
	return { insertCount: rows.length - updates, updateCount: updates };
}

export const actions: Actions = {
	dryRun: async ({ request, locals }) => {
		if (!locals.admin) return fail(401, { message: 'Not signed in.' });

		const contentLength = Number(request.headers.get('content-length') ?? '0');
		if (contentLength > MAX_FILE_BYTES) {
			return fail(413, { message: `File is too large (>${MAX_FILE_BYTES} bytes).` });
		}

		let form: FormData;
		try {
			form = await request.formData();
		} catch (err) {
			return fail(400, { message: `Could not read upload: ${(err as Error).message}` });
		}

		const file = form.get('file');
		if (!(file instanceof File)) {
			return fail(400, { message: 'Choose a CSV file to upload.' });
		}
		if (file.size === 0) {
			return fail(400, { message: 'File is empty.' });
		}
		if (file.size > MAX_FILE_BYTES) {
			return fail(413, { message: `File is too large (>${MAX_FILE_BYTES} bytes).` });
		}

		const bytes = new Uint8Array(await file.arrayBuffer());
		const fileSha256 = createHash('sha256').update(bytes).digest('hex');
		const parsed = parseVacancyCsv(bytes);

		// If anything failed to parse at all, short-circuit — nothing to stage.
		if (!parsed.ok && parsed.validRows.length === 0) {
			return fail(400, {
				message: 'CSV has errors and cannot be committed.',
				errors: parsed.errors.slice(0, ERROR_DISPLAY_LIMIT),
				warnings: parsed.warnings.slice(0, WARNING_DISPLAY_LIMIT)
			});
		}

		const { insertCount, updateCount } = await diffAgainstDb(parsed.validRows);

		const staged = await stageUpload({
			kind: 'vacancy_rates',
			validRows: parsed.validRows,
			rowCount: parsed.validRows.length,
			errorCount: parsed.errors.length,
			warningCount: parsed.warnings.length,
			insertCount,
			updateCount,
			fileSha256,
			filename: file.name || 'upload.csv',
			adminTokenHash: locals.admin.tokenHash
		});

		return {
			stagedId: staged.id,
			filename: staged.filename,
			fileSha256,
			rowCount: parsed.validRows.length,
			insertCount,
			updateCount,
			errors: parsed.errors.slice(0, ERROR_DISPLAY_LIMIT),
			totalErrors: parsed.errors.length,
			warnings: parsed.warnings.slice(0, WARNING_DISPLAY_LIMIT),
			totalWarnings: parsed.warnings.length,
			sample: staged.sample,
			canCommit: parsed.errors.length === 0
		};
	},

	commit: async ({ request, locals }) => {
		if (!locals.admin) return fail(401, { message: 'Not signed in.' });

		const form = await request.formData();
		const stagedId = String(form.get('stagedId') ?? '');
		if (!stagedId) return fail(400, { message: 'Missing staged upload id.' });

		const db = assertDb();
		const adminTokenHash = locals.admin.tokenHash;

		// Upsert in a transaction so either the whole batch lands or nothing does.
		let result: { staged: StagedVacancyUpload; upserted: number } | null = null;
		try {
			result = await db.transaction(async (tx) => {
				const staged = await consumeStaged(tx, stagedId, adminTokenHash, 'vacancy_rates');
				if (!staged) return null;

				let upserted = 0;
				const payload = staged.validRows.map((r) => ({
					year: r.year,
					quarter: r.quarter,
					cbsaCode: r.cbsaCode,
					rentalVacancyPct: r.rentalVacancyPct.toFixed(2)
				}));
				for (let i = 0; i < payload.length; i += 1000) {
					const batch = payload.slice(i, i + 1000);
					await tx
						.insert(vacancyRates)
						.values(batch)
						.onConflictDoUpdate({
							target: [vacancyRates.year, vacancyRates.quarter, vacancyRates.cbsaCode],
							set: {
								rentalVacancyPct: sql.raw(`excluded.${vacancyRates.rentalVacancyPct.name}`)
							}
						});
					upserted += batch.length;
				}

				await tx.insert(adminUploads).values({
					kind: staged.kind,
					filename: staged.filename,
					fileSha256: staged.fileSha256,
					rowCount: staged.rowCount,
					insertCount: staged.insertCount,
					updateCount: staged.updateCount
				});

				return { staged, upserted };
			});
		} catch (err) {
			return fail(500, { message: `Commit failed: ${(err as Error).message}` });
		}
		if (!result) {
			return fail(400, {
				message: 'Staged upload expired or was already committed. Please re-upload.'
			});
		}

		return {
			committed: true,
			upserted: result.upserted,
			insertCount: result.staged.insertCount,
			updateCount: result.staged.updateCount,
			filename: result.staged.filename
		};
	}
};
