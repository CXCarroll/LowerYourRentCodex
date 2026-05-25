import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { fail, type Actions } from '@sveltejs/kit';
import { assertDb } from '$lib/server/db/client';
import { acsRent, adminUploads } from '$lib/server/db/schema';
import {
	MAX_FILE_BYTES,
	parseAcsRentCsv,
	type AcsRentRowInput
} from '$lib/server/admin/acs-csv';
import { consumeStaged, stageUpload, type StagedAcsRentUpload } from '$lib/server/admin/staging';

const ERROR_DISPLAY_LIMIT = 50;
const WARNING_DISPLAY_LIMIT = 20;

async function diffAgainstDb(rows: AcsRentRowInput[]): Promise<{
	insertCount: number;
	updateCount: number;
}> {
	if (rows.length === 0) return { insertCount: 0, updateCount: 0 };
	const db = assertDb();
	const byYearLevel = new Map<string, Set<string>>();
	for (const r of rows) {
		const k = `${r.year}|${r.geoLevel}`;
		let set = byYearLevel.get(k);
		if (!set) {
			set = new Set<string>();
			byYearLevel.set(k, set);
		}
		set.add(r.geoId);
	}

	let updates = 0;
	for (const [k, geoIdsSet] of byYearLevel) {
		const [yearStr, geoLevel] = k.split('|');
		const year = Number(yearStr);
		const geoIds = Array.from(geoIdsSet);
		for (let i = 0; i < geoIds.length; i += 5000) {
			const chunk = geoIds.slice(i, i + 5000);
			const existing = await db
				.select({ geoId: acsRent.geoId })
				.from(acsRent)
				.where(
					and(
						eq(acsRent.year, year),
						eq(acsRent.geoLevel, geoLevel),
						inArray(acsRent.geoId, chunk)
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
		if (file.size === 0) return fail(400, { message: 'File is empty.' });
		if (file.size > MAX_FILE_BYTES) {
			return fail(413, { message: `File is too large (>${MAX_FILE_BYTES} bytes).` });
		}

		const bytes = new Uint8Array(await file.arrayBuffer());
		const fileSha256 = createHash('sha256').update(bytes).digest('hex');
		const parsed = parseAcsRentCsv(bytes);

		if (!parsed.ok && parsed.validRows.length === 0) {
			return fail(400, {
				message: 'CSV has errors and cannot be committed.',
				errors: parsed.errors.slice(0, ERROR_DISPLAY_LIMIT),
				warnings: parsed.warnings.slice(0, WARNING_DISPLAY_LIMIT)
			});
		}

		const { insertCount, updateCount } = await diffAgainstDb(parsed.validRows);

		const staged = await stageUpload({
			kind: 'acs_rent',
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
		let result: { staged: StagedAcsRentUpload; upserted: number } | null = null;
		try {
			result = await db.transaction(async (tx) => {
				const staged = await consumeStaged(tx, stagedId, adminTokenHash, 'acs_rent');
				if (!staged) return null;

				let upserted = 0;
				const payload = staged.validRows.map((r) => ({
					year: r.year,
					geoLevel: r.geoLevel,
					geoId: r.geoId,
					medianGrossRentCents: r.medianGrossRentCents,
					sampleSize: r.sampleSize
				}));
				for (let i = 0; i < payload.length; i += 1000) {
					const batch = payload.slice(i, i + 1000);
					await tx
						.insert(acsRent)
						.values(batch)
						.onConflictDoUpdate({
							target: [acsRent.year, acsRent.geoLevel, acsRent.geoId],
							set: {
								medianGrossRentCents: sql.raw(
									`excluded.${acsRent.medianGrossRentCents.name}`
								),
								sampleSize: sql.raw(`excluded.${acsRent.sampleSize.name}`)
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
