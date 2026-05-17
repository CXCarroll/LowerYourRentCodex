import { describe, expect, test } from 'bun:test';
import { normalizeBuildingAddress } from '../../src/lib/server/address';

describe('normalizeBuildingAddress', () => {
	test('strips unit suffix "Apt 4B"', () => {
		const n = normalizeBuildingAddress('123 Main St, Apt 4B, Brooklyn, NY 11201');
		expect(n.zip).toBe('11201');
		expect(n.building).not.toMatch(/apt|4b/i);
		expect(n.building).toMatch(/\bNY\b/);
	});

	test('strips "Unit 12"', () => {
		const n = normalizeBuildingAddress('742 Evergreen Terrace Unit 12, Springfield, IL 62704');
		expect(n.zip).toBe('62704');
		expect(n.building).not.toMatch(/unit|12,/i);
	});

	test('strips "#204"', () => {
		const n = normalizeBuildingAddress('500 Market St #204, San Francisco, CA 94105');
		expect(n.zip).toBe('94105');
		expect(n.building).not.toMatch(/#204|204,/);
	});

	test('strips "Suite"', () => {
		const n = normalizeBuildingAddress('1 World Trade Center Suite 2200, New York, NY 10007');
		expect(n.zip).toBe('10007');
		expect(n.building).not.toMatch(/suite|2200/i);
	});

	test('handles address with no unit', () => {
		const n = normalizeBuildingAddress('450 Serra Mall, Stanford, CA 94305');
		expect(n.zip).toBe('94305');
		expect(n.building).toMatch(/450/);
		expect(n.building).toMatch(/\bCA\b/);
	});

	test('state abbreviation is uppercased', () => {
		const n = normalizeBuildingAddress('100 N wacker dr, chicago, il 60606');
		expect(n.building).toMatch(/\bIL\b/);
		expect(n.building).not.toMatch(/\bIl\b/);
	});

	test('same address different case hashes identically', () => {
		const a = normalizeBuildingAddress('123 Main St, Brooklyn, NY 11201');
		const b = normalizeBuildingAddress('  123 MAIN ST , BROOKLYN,  NY 11201  ');
		expect(a.addressHash).toBe(b.addressHash);
	});

	test('different units on same building hash identically', () => {
		const a = normalizeBuildingAddress('123 Main St, Apt 1, Brooklyn, NY 11201');
		const b = normalizeBuildingAddress('123 Main St, Apt 22, Brooklyn, NY 11201');
		expect(a.addressHash).toBe(b.addressHash);
	});

	test('falls back gracefully on malformed input', () => {
		const n = normalizeBuildingAddress('  ');
		expect(n.zip).toBeNull();
		expect(n.building).toBe('');
	});

	test('extracts ZIP from 9-digit ZIP+4', () => {
		const n = normalizeBuildingAddress('1 Main St, Anytown, NY 10001-1234');
		expect(n.zip).toBe('10001');
	});
});
