import { describe, expect, mock, test } from 'bun:test';

mock.module('$lib/server/db/client', () => ({ db: null }));
mock.module('$lib/server/admin/zip-explorer', () => ({ getZipInsight: async () => null }));
mock.module('$lib/server/proposal', () => ({ computeProposal: async () => null }));

const { buildNegotiationEmail } = await import('../../src/lib/server/negotiation-email');

describe('buildNegotiationEmail', () => {
	test('renders from validated rent cents instead of parsing raw rent fallbacks', async () => {
		const { versions } = await buildNegotiationEmail(
			{
				address: '123 Main St Brooklyn NY 11201',
				aptType: '1br',
				rentCents: 310_000,
				zip: '11201'
			},
			fetch
		);

		expect(versions[0].body).toContain('$3,100');
		expect(versions[0].body).not.toContain('$2,500');
	});
});
