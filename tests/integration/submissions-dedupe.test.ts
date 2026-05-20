import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { InsertSubmissionArgs } from '../../src/lib/server/submissions';

type LoadedModules = Awaited<ReturnType<typeof loadModules>>;

async function loadModules() {
	const [{ and, eq, sql }, { db, closeDb }, schema, address, submissions] = await Promise.all([
		import('drizzle-orm'),
		import('../../src/lib/server/db/client'),
		import('../../src/lib/server/db/schema'),
		import('../../src/lib/server/address'),
		import('../../src/lib/server/submissions')
	]);

	if (!db) {
		throw new Error('DATABASE_URL is required for submission dedupe concurrency tests.');
	}

	return { and, eq, sql, db, closeDb, schema, address, submissions };
}

if (!process.env.DATABASE_URL) {
	describe.skip('submission dedupe concurrency', () => {
		test('requires DATABASE_URL', () => {});
	});
} else {
	describe('submission dedupe concurrency', () => {
		let modules: LoadedModules;

		beforeAll(async () => {
			process.env.NODE_ENV = 'test';
			mock.module('$env/dynamic/private', () => ({ env: process.env }));
			mock.module('$app/environment', () => ({ building: false }));

			modules = await loadModules();
		});

		afterAll(async () => {
			await modules?.closeDb();
		});

		async function cleanup(addressHash: string) {
			const { db, eq, schema } = modules;
			await db
				.delete(schema.submissions)
				.where(eq(schema.submissions.addressHash, addressHash));
			await db
				.delete(schema.submissionDedupeKeys)
				.where(eq(schema.submissionDedupeKeys.addressHash, addressHash));
		}

		function uniqueStreet() {
			const digits = randomUUID().replace(/\D/g, '').slice(0, 6);
			const number = Number.parseInt(digits, 10) || 123456;
			return `${number} Main St`;
		}

		function argsFor(
			rawAddress: string,
			overrides: Partial<InsertSubmissionArgs> = {}
		): InsertSubmissionArgs {
			const normalized = modules.address.normalizeBuildingAddress(rawAddress);
			return {
				buildingAddress: normalized.building,
				addressHash: normalized.addressHash,
				unitHash: normalized.unitHash,
				zip: normalized.zip ?? '11201',
				countyFips: '36047',
				cbsaCode: '35620',
				aptType: '1br' as const,
				rentCents: 250_000,
				leaseExpiry: '2099-01-01',
				...overrides
			};
		}

		async function insert(args: ReturnType<typeof argsFor>) {
			return modules.db.transaction((tx) =>
				modules.submissions.insertSubmissionUnlessRecentDuplicateTx(tx, args)
			);
		}

		async function submissionCount(addressHash: string) {
			const [row] = (await modules.db
				.select({ n: modules.sql<number>`count(*)::int` })
				.from(modules.schema.submissions)
				.where(modules.eq(modules.schema.submissions.addressHash, addressHash))) as Array<{
				n: number;
			}>;
			return row?.n ?? 0;
		}

		test('only one concurrent insert lands for the same building, unit, and apt type', async () => {
			const base = argsFor(`${uniqueStreet()} Apt 4B, Brooklyn, NY 11201`);

			try {
				const results = await Promise.all(Array.from({ length: 8 }, () => insert(base)));

				expect(results.filter((result) => result.inserted)).toHaveLength(1);
				expect(await submissionCount(base.addressHash)).toBe(1);
			} finally {
				await cleanup(base.addressHash);
			}
		});

		test('different units at the same building can both insert', async () => {
			const street = uniqueStreet();
			const first = argsFor(`${street} Apt 1, Brooklyn, NY 11201`);
			const second = argsFor(`${street} Apt 2, Brooklyn, NY 11201`);

			try {
				const results = await Promise.all([insert(first), insert(second)]);

				expect(results.every((result) => result.inserted)).toBe(true);
				expect(first.addressHash).toBe(second.addressHash);
				expect(first.unitHash).not.toBe(second.unitHash);
				expect(await submissionCount(first.addressHash)).toBe(2);
			} finally {
				await cleanup(first.addressHash);
			}
		});

		test('different apartment-size buckets at the same building can both insert', async () => {
			const first = argsFor(`${uniqueStreet()}, Brooklyn, NY 11201`, {
				aptType: 'studio'
			});
			const second = { ...first, aptType: '1br' as const, rentCents: 260_000 };

			try {
				const results = await Promise.all([insert(first), insert(second)]);

				expect(results.every((result) => result.inserted)).toBe(true);
				expect(await submissionCount(first.addressHash)).toBe(2);
			} finally {
				await cleanup(first.addressHash);
			}
		});

		test('same apartment can submit again after the dedupe key expires', async () => {
			const base = argsFor(`${uniqueStreet()} Apt 8, Brooklyn, NY 11201`);

			try {
				expect(await insert(base)).toEqual({ inserted: true });
				await modules.db
					.update(modules.schema.submissionDedupeKeys)
					.set({ expiresAt: new Date(Date.now() - 1000) })
					.where(
						modules.and(
							modules.eq(modules.schema.submissionDedupeKeys.addressHash, base.addressHash),
							modules.eq(modules.schema.submissionDedupeKeys.aptType, base.aptType)
						)
					);

				expect(await insert({ ...base, rentCents: 255_000 })).toEqual({ inserted: true });
				expect(await submissionCount(base.addressHash)).toBe(2);
			} finally {
				await cleanup(base.addressHash);
			}
		});
	});
}
