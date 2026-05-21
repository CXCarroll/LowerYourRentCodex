import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';

type LoadedModules = Awaited<ReturnType<typeof loadModules>>;

async function loadModules() {
	const [{ eq }, { db }, schema, staging] = await Promise.all([
		import('drizzle-orm'),
		import('../../src/lib/server/db/client'),
		import('../../src/lib/server/db/schema'),
		import('../../src/lib/server/admin/staging')
	]);

	if (!db) {
		throw new Error('DATABASE_URL is required for admin upload staging tests.');
	}

	return { eq, db, schema, staging };
}

if (!process.env.DATABASE_URL) {
	describe.skip('admin upload staging', () => {
		test('requires DATABASE_URL', () => {});
	});
} else {
	describe('admin upload staging', () => {
		let modules: LoadedModules;

		beforeAll(async () => {
			process.env.NODE_ENV = 'test';

			mock.module('$env/dynamic/private', () => ({ env: process.env }));
			mock.module('$app/environment', () => ({ building: false }));

			modules = await loadModules();
		});

		afterEach(async () => {
			await modules?.staging._resetStaging();
		});

		function vacancyUpload(adminTokenHash = 'admin-token-a') {
			return modules.staging.stageUpload({
				kind: 'vacancy_rates',
				adminTokenHash,
				filename: 'vacancy.csv',
				fileSha256: 'a'.repeat(64),
				validRows: [{ year: 2025, quarter: 2, cbsaCode: '35620', rentalVacancyPct: 4.5 }],
				rowCount: 1,
				errorCount: 0,
				warningCount: 0,
				insertCount: 1,
				updateCount: 0
			});
		}

		test('stages and reads upload rows from Postgres', async () => {
			const staged = await vacancyUpload();
			const peeked = await modules.staging.peekStaged(staged.id, staged.adminTokenHash);

			expect(peeked?.id).toBe(staged.id);
			expect(peeked?.kind).toBe('vacancy_rates');
			expect(peeked?.validRows).toEqual(staged.validRows);
			expect(peeked?.sample).toEqual(staged.validRows);
		});

		test('does not expose staged rows to another admin token', async () => {
			const staged = await vacancyUpload();

			expect(await modules.staging.peekStaged(staged.id, 'different-token')).toBeNull();
			const consumed = await modules.db.transaction((tx) =>
				modules.staging.consumeStaged(tx, staged.id, 'different-token', 'vacancy_rates')
			);
			expect(consumed).toBeNull();
			expect(await modules.staging.peekStaged(staged.id, staged.adminTokenHash)).not.toBeNull();
		});

		test('consumes a staged upload once', async () => {
			const staged = await vacancyUpload();

			const first = await modules.db.transaction((tx) =>
				modules.staging.consumeStaged(tx, staged.id, staged.adminTokenHash, 'vacancy_rates')
			);
			const second = await modules.db.transaction((tx) =>
				modules.staging.consumeStaged(tx, staged.id, staged.adminTokenHash, 'vacancy_rates')
			);

			expect(first?.id).toBe(staged.id);
			expect(second).toBeNull();
		});

		test('does not consume expired staged uploads', async () => {
			const staged = await vacancyUpload();
			await modules.db
				.update(modules.schema.adminUploadStaging)
				.set({ expiresAt: new Date(Date.now() - 1000) })
				.where(modules.eq(modules.schema.adminUploadStaging.id, staged.id));

			const consumed = await modules.db.transaction((tx) =>
				modules.staging.consumeStaged(tx, staged.id, staged.adminTokenHash, 'vacancy_rates')
			);

			expect(consumed).toBeNull();
		});

		test('restores consumed upload when the surrounding transaction rolls back', async () => {
			const staged = await vacancyUpload();

			await expect(
				modules.db.transaction(async (tx) => {
					const consumed = await modules.staging.consumeStaged(
						tx,
						staged.id,
						staged.adminTokenHash,
						'vacancy_rates'
					);
					expect(consumed?.id).toBe(staged.id);
					throw new Error('rollback');
				})
			).rejects.toThrow('rollback');

			expect(await modules.staging.peekStaged(staged.id, staged.adminTokenHash)).not.toBeNull();
		});
	});
}
