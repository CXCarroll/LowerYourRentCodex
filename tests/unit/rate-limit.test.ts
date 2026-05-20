import { beforeEach, describe, expect, mock, test } from 'bun:test';

const env = {
	EMAIL_PEPPER: 'test-email-pepper',
	RATE_LIMIT_PEPPER: 'test-rate-limit-pepper',
	TRUST_CF_CONNECTING_IP: false,
	TRUSTED_PROXY_CIDRS: undefined as string | undefined
};

mock.module('$lib/server/env', () => ({ env }));
mock.module('$lib/server/db/client', () => ({ db: null }));

const { getClientIp } = await import('../../src/lib/server/rate-limit');

function event(headers: Record<string, string>, socketIp: string) {
	return {
		request: new Request('http://localhost/', { headers }),
		getClientAddress: () => socketIp
	};
}

beforeEach(() => {
	env.TRUST_CF_CONNECTING_IP = false;
	env.TRUSTED_PROXY_CIDRS = undefined;
});

describe('getClientIp', () => {
	test('ignores spoofed forwarding headers when the socket is not trusted', () => {
		const ip = getClientIp(
			event(
				{
					'x-forwarded-for': '198.51.100.55',
					'x-real-ip': '198.51.100.56'
				},
				'203.0.113.10'
			)
		);

		expect(ip).toBe('203.0.113.10');
	});

	test('walks X-Forwarded-For from a trusted proxy chain', () => {
		env.TRUSTED_PROXY_CIDRS = '10.0.0.0/8';

		const ip = getClientIp(
			event({ 'x-forwarded-for': '198.51.100.20, 10.1.2.3' }, '10.9.8.7')
		);

		expect(ip).toBe('198.51.100.20');
	});

	test('trusts CF-Connecting-IP only when explicitly enabled', () => {
		env.TRUST_CF_CONNECTING_IP = true;
		env.TRUSTED_PROXY_CIDRS = '10.0.0.0/8';

		const ip = getClientIp(event({ 'cf-connecting-ip': '198.51.100.30' }, '10.0.0.10'));

		expect(ip).toBe('198.51.100.30');
	});

	test('falls back to the socket address for invalid forwarded values', () => {
		env.TRUSTED_PROXY_CIDRS = '10.0.0.0/8';

		const ip = getClientIp(event({ 'x-forwarded-for': 'not-an-ip' }, '10.9.8.7'));

		expect(ip).toBe('10.9.8.7');
	});
});
