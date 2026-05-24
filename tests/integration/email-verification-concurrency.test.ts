import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

type LoadedModules = Awaited<ReturnType<typeof loadModules>>;

async function loadModules() {
	const [{ desc, eq }, { db }, schema, verification] = await Promise.all([
		import('drizzle-orm'),
		import('../../src/lib/server/db/client'),
		import('../../src/lib/server/db/schema'),
		import('../../src/lib/server/email-verification')
	]);

	if (!db) {
		throw new Error('DATABASE_URL is required for email verification concurrency tests.');
	}

	return { desc, eq, db, schema, verification };
}

if (!process.env.DATABASE_URL) {
	describe.skip('email verification concurrency', () => {
		test('requires DATABASE_URL', () => {});
	});
} else {
	describe('email verification concurrency', () => {
		let modules: LoadedModules;

		beforeAll(async () => {
			process.env.NODE_ENV = 'test';
			process.env.EMAIL_PEPPER = 'email-verification-concurrency-test-pepper';

			mock.module('$env/dynamic/private', () => ({ env: process.env }));
			mock.module('$env/dynamic/public', () => ({ env: process.env }));
			mock.module('$app/environment', () => ({ building: false }));

			modules = await loadModules();
		});

		async function cleanup(email: string, ip: string) {
			const { db, eq, schema } = modules;
			await db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.ip, ip));
			await db.delete(schema.verifiedEmails).where(eq(schema.verifiedEmails.email, email));
		}

		test('only one parallel valid-code verification can consume a row', async () => {
			const email = `verify-race-${randomUUID()}@example.com`;
			const ip = `test-valid-${randomUUID()}`;

			try {
				const requested = await modules.verification.requestCode(email, ip);
				expect(requested.ok).toBe(true);
				if (!requested.ok) throw new Error('requestCode unexpectedly failed');

				const results = await Promise.all([
					modules.verification.verifyCode(email, requested.code),
					modules.verification.verifyCode(email, requested.code)
				]);

				expect(results.filter((result) => result.ok)).toHaveLength(1);
				expect(results.filter((result) => !result.ok && result.reason === 'not_found')).toHaveLength(
					1
				);

				const [verified] = await modules.db
					.select()
					.from(modules.schema.verifiedEmails)
					.where(modules.eq(modules.schema.verifiedEmails.email, email));

				expect(verified?.verifyCount).toBe(1);
			} finally {
				await cleanup(email, ip);
			}
		});

		test('parallel bad-code attempts do not lose attempt increments', async () => {
			const email = `attempt-race-${randomUUID()}@example.com`;
			const ip = `test-bad-${randomUUID()}`;

			try {
				const requested = await modules.verification.requestCode(email, ip);
				expect(requested.ok).toBe(true);
				if (!requested.ok) throw new Error('requestCode unexpectedly failed');
				const badCode = requested.code === '000000' ? '000001' : '000000';

				const results = await Promise.all(
					Array.from({ length: modules.verification.MAX_ATTEMPTS + 3 }, () =>
						modules.verification.verifyCode(email, badCode)
					)
				);

				expect(
					results.filter((result) => !result.ok && result.reason === 'bad_code')
				).toHaveLength(modules.verification.MAX_ATTEMPTS);
				expect(
					results.filter((result) => !result.ok && result.reason === 'too_many_attempts')
				).toHaveLength(3);

				const [row] = await modules.db
					.select()
					.from(modules.schema.emailVerifications)
					.where(modules.eq(modules.schema.emailVerifications.ip, ip))
					.orderBy(modules.desc(modules.schema.emailVerifications.createdAt))
					.limit(1);

				expect(row?.attempts).toBe(modules.verification.MAX_ATTEMPTS);
				expect(row?.consumedAt).toBeNull();
			} finally {
				await cleanup(email, ip);
			}
		});
	});
}
