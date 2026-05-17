import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { fail, type Actions } from '@sveltejs/kit';
import { assertDb } from '$lib/server/db/client';
import { hudFmr, adminUploads } from '$lib/server/db/schema';
import {
	MAX_FILE_BYTES,
	parseFmrCsv,
	type FmrRowInput
} from '$lib/server/admin/fmr-csv';
import { consumeStaged, stageUpload } from '$lib/server/admin/staging';

const SAMPLE_LIMIT = 10;
const ERROR_DISPLAY_LIMIT = 50;
const WARNING_DISPLAY_LIMIT = 20;

async function diffAgainstDb(rows: FmrRowInput[]): Promise<{
	insertCount: number;
	updateCount: number;
}> {
	if (rows.length === 0) return { insertCount: 0, updateCount: 0 };
	const db = assertDb();
	// Group by (year, apt_type); for each group, look up existing county_fips.
	const groups = new Map<string, Set<string>>();
	for (const r of rows) {
		const k = `${r.year}|${r.aptType}`;
		let set = groups.get(k);
		if (!set) {
			set = new Set<string>();
			groups.set(k, set);
		}
		set.add(r.countyFips);
	}
	let updates = 0;
	for (const [k, countySet] of groups) {
		const [yearStr, aptType] = k.split('|');
		const year = Number(yearStr);
		const counties = Array.from(countySet);
		for (let i = 0; i < counties.length; i += 5000) {
			const chunk = counties.slice(i, i + 5000);
			const existing = await db
				.select({ countyFips: hudFmr.countyFips })
				.from(hudFmr)
				.where(
					and(
						eq(hudFmr.year, year),
						eq(hudFmr.aptType, aptType as FmrRowInput['aptType']),
						inArray(hudFmr.countyFips, chunk)
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
		const parsed = parseFmrCsv(bytes);

		if (!parsed.ok && parsed.validRows.length === 0) {
			return fail(400, {
				message: 'CSV has errors and cannot be committed.',
				errors: parsed.errors.slice(0, ERROR_DISPLAY_LIMIT),
				warnings: parsed.warnings.slice(0, WARNING_DISPLAY_LIMIT)
			});
		}

		const { insertCount, updateCount } = await diffAgainstDb(parsed.validRows);

		const staged = stageUpload({
			kind: 'hud_fmr',
			validRows: parsed.validRows,
			rowCount: parsed.validRows.length,
			errorCount: parsed.errors.length,
			warningCount: parsed.warnings.length,
			insertCount,
			updateCount,
			sample: parsed.validRows.slice(0, SAMPLE_LIMIT),
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

		const staged = consumeStaged(stagedId, locals.admin.tokenHash);
		if (!staged) {
			return fail(400, {
				message: 'Staged upload expired or was already committed. Please re-upload.'
			});
		}
		if (staged.kind !== 'hud_fmr') {
			return fail(400, { message: 'Staged upload is not an FMR upload.' });
		}

		const db = assertDb();
		let upserted = 0;
		try {
			await db.transaction(async (tx) => {
				const payload = staged.validRows.map((r) => ({
					year: r.year,
					countyFips: r.countyFips,
					aptType: r.aptType,
					fmrCents: r.fmrCents
				}));
				for (let i = 0; i < payload.length; i += 1000) {
					const batch = payload.slice(i, i + 1000);
					await tx
						.insert(hudFmr)
						.values(batch)
						.onConflictDoUpdate({
							target: [hudFmr.year, hudFmr.countyFips, hudFmr.aptType],
							set: { fmrCents: sql.raw(`excluded.${hudFmr.fmrCents.name}`) }
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
			});
		} catch (err) {
			return fail(500, { message: `Commit failed: ${(err as Error).message}` });
		}

		return {
			committed: true,
			upserted,
			insertCount: staged.insertCount,
			updateCount: staged.updateCount,
			filename: staged.filename
		};
	}
};
