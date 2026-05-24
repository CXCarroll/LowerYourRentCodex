import { describe, expect, mock, test } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: process.env }));
mock.module('$env/dynamic/public', () => ({ env: process.env }));
mock.module('$app/environment', () => ({ building: false }));

const { parseEnv } = await import('../../src/lib/server/env');

describe('parseEnv VERIFY_CHECK_TIMING_SAMPLE_RATE', () => {
	test('accepts explicit sample rates from 0 to 1', () => {
		expect(parseEnv({ NODE_ENV: 'production', VERIFY_CHECK_TIMING_SAMPLE_RATE: '0' }, true).VERIFY_CHECK_TIMING_SAMPLE_RATE).toBe(0);
		expect(parseEnv({ NODE_ENV: 'production', VERIFY_CHECK_TIMING_SAMPLE_RATE: '0.05' }, true).VERIFY_CHECK_TIMING_SAMPLE_RATE).toBe(0.05);
		expect(parseEnv({ NODE_ENV: 'production', VERIFY_CHECK_TIMING_SAMPLE_RATE: '1' }, true).VERIFY_CHECK_TIMING_SAMPLE_RATE).toBe(1);
	});

	test('defaults to 1 outside production and 0.05 in production', () => {
		expect(parseEnv({ NODE_ENV: 'development' }, true).VERIFY_CHECK_TIMING_SAMPLE_RATE).toBe(1);
		expect(parseEnv({ NODE_ENV: 'test' }, true).VERIFY_CHECK_TIMING_SAMPLE_RATE).toBe(1);
		expect(parseEnv({ NODE_ENV: 'production' }, true).VERIFY_CHECK_TIMING_SAMPLE_RATE).toBe(0.05);
	});

	test('rejects invalid sample rates', () => {
		const originalConsoleError = console.error;
		console.error = () => {};
		try {
			expect(() =>
				parseEnv({ NODE_ENV: 'development', VERIFY_CHECK_TIMING_SAMPLE_RATE: '-0.1' }, true)
			).toThrow('Refusing to boot');
			expect(() =>
				parseEnv({ NODE_ENV: 'development', VERIFY_CHECK_TIMING_SAMPLE_RATE: '1.1' }, true)
			).toThrow('Refusing to boot');
			expect(() =>
				parseEnv({ NODE_ENV: 'development', VERIFY_CHECK_TIMING_SAMPLE_RATE: 'sometimes' }, true)
			).toThrow('Refusing to boot');
		} finally {
			console.error = originalConsoleError;
		}
	});
});

describe('parseEnv production requirements', () => {
	const productionBase = {
		NODE_ENV: 'production',
		DATABASE_URL: 'postgres://user:pass@example.com:5432/db',
		EMAIL_PEPPER: 'pepper',
		RESEND_API_KEY: 'resend',
		EMAIL_FROM: 'Lower Your Rent <verify@example.com>',
		TURNSTILE_SECRET_KEY: 'turnstile-secret'
	};

	test('requires the public Turnstile site key when production Turnstile is enforced', () => {
		expect(() => parseEnv(productionBase, false)).toThrow('PUBLIC_TURNSTILE_SITE_KEY');
	});

	test('accepts production when the Turnstile public and private keys are both present', () => {
		expect(
			parseEnv({ ...productionBase, PUBLIC_TURNSTILE_SITE_KEY: 'turnstile-site' }, false)
				.PUBLIC_TURNSTILE_SITE_KEY
		).toBe('turnstile-site');
	});

	test('does not require Turnstile keys in demo mode', () => {
		expect(
			parseEnv(
				{
					NODE_ENV: 'production',
					DEMO_MODE: 'true',
					DATABASE_URL: 'postgres://user:pass@example.com:5432/db',
					EMAIL_PEPPER: 'pepper'
				},
				false
			).DEMO_MODE
		).toBe(true);
	});
});
