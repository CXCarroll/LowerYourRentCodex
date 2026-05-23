import { describe, expect, mock, test } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: process.env }));
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
