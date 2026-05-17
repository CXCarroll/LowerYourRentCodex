import { describe, expect, test } from 'bun:test';
import {
	generateCode,
	hashCode,
	hashEmail,
	normalizeEmail
} from '../../src/lib/server/email-verification-crypto';

const PEPPER = 'test-pepper';
const HEX_64 = /^[0-9a-f]{64}$/;

describe('generateCode', () => {
	test('always returns exactly 6 digits, zero-padded', () => {
		for (let i = 0; i < 2000; i++) {
			const code = generateCode();
			expect(code).toMatch(/^\d{6}$/);
			expect(code.length).toBe(6);
		}
	});

	test('produces a spread of values (not a constant)', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 200; i++) seen.add(generateCode());
		expect(seen.size).toBeGreaterThan(1);
	});
});

describe('normalizeEmail', () => {
	test('trims surrounding whitespace and lowercases', () => {
		expect(normalizeEmail('  Tenant@Example.COM ')).toBe('tenant@example.com');
	});
});

describe('hashEmail', () => {
	test('is a 64-char hex sha256 digest', () => {
		expect(hashEmail(PEPPER, 'a@b.com')).toMatch(HEX_64);
	});

	test('is deterministic for the same pepper + email', () => {
		expect(hashEmail(PEPPER, 'a@b.com')).toBe(hashEmail(PEPPER, 'a@b.com'));
	});

	test('ignores case and surrounding whitespace', () => {
		expect(hashEmail(PEPPER, '  A@B.COM ')).toBe(hashEmail(PEPPER, 'a@b.com'));
	});

	test('differs for a different email', () => {
		expect(hashEmail(PEPPER, 'a@b.com')).not.toBe(hashEmail(PEPPER, 'c@d.com'));
	});

	test('differs for a different pepper', () => {
		expect(hashEmail(PEPPER, 'a@b.com')).not.toBe(hashEmail('other-pepper', 'a@b.com'));
	});
});

describe('hashCode', () => {
	test('is a 64-char hex sha256 digest', () => {
		expect(hashCode(PEPPER, 'row-1', '123456')).toMatch(HEX_64);
	});

	test('is deterministic for the same pepper + row id + code', () => {
		expect(hashCode(PEPPER, 'row-1', '123456')).toBe(hashCode(PEPPER, 'row-1', '123456'));
	});

	test('the same code hashes differently across row ids (no cross-row replay)', () => {
		expect(hashCode(PEPPER, 'row-1', '123456')).not.toBe(
			hashCode(PEPPER, 'row-2', '123456')
		);
	});

	test('differs for a different code on the same row', () => {
		expect(hashCode(PEPPER, 'row-1', '123456')).not.toBe(
			hashCode(PEPPER, 'row-1', '654321')
		);
	});

	test('differs for a different pepper', () => {
		expect(hashCode(PEPPER, 'row-1', '123456')).not.toBe(
			hashCode('other-pepper', 'row-1', '123456')
		);
	});
});
