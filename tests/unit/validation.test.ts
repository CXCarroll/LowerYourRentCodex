import { describe, expect, test } from 'bun:test';
import { rentInputToCents, submissionSchema } from '../../src/lib/shared/validation';

describe('rentInputToCents', () => {
	test('converts formatted dollar input to cents', () => {
		expect(rentInputToCents('2,500')).toBe(250_000);
		expect(rentInputToCents('$3100')).toBe(310_000);
	});

	test('rejects malformed rent input', () => {
		expect(rentInputToCents('')).toBeNull();
		expect(rentInputToCents('not rent')).toBeNull();
		expect(rentInputToCents('2.500')).toBeNull();
	});
});

describe('submissionSchema', () => {
	test('requires typed rent cents and a valid apartment type', () => {
		const parsed = submissionSchema.safeParse({
			address: '123 Main St, Brooklyn, NY 11201',
			aptType: 'penthouse',
			rentCents: '250000',
			leaseExpiry: '2099-01-01'
		});

		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
			expect(paths).toContain('aptType');
			expect(paths).toContain('rentCents');
		}
	});
});
