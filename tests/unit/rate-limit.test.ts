import { beforeEach, describe, expect, test } from 'bun:test';
import { resolveClientIp } from '../../src/lib/server/client-ip';

const config = {
	trustCfConnectingIp: false,
	trustedProxyCidrs: undefined as string | undefined
};

function event(headers: Record<string, string>, socketIp: string) {
	return {
		request: new Request('http://localhost/', { headers }),
		getClientAddress: () => socketIp
	};
}

beforeEach(() => {
	config.trustCfConnectingIp = false;
	config.trustedProxyCidrs = undefined;
});

describe('getClientIp', () => {
	test('ignores spoofed forwarding headers when the socket is not trusted', () => {
		const ip = resolveClientIp(
			event(
				{
					'x-forwarded-for': '198.51.100.55',
					'x-real-ip': '198.51.100.56'
				},
				'203.0.113.10'
			),
			config
		);

		expect(ip).toBe('203.0.113.10');
	});

	test('walks X-Forwarded-For from a trusted proxy chain', () => {
		config.trustedProxyCidrs = '10.0.0.0/8';

		const ip = resolveClientIp(
			event({ 'x-forwarded-for': '198.51.100.20, 10.1.2.3' }, '10.9.8.7'),
			config
		);

		expect(ip).toBe('198.51.100.20');
	});

	test('trusts CF-Connecting-IP only when explicitly enabled', () => {
		config.trustCfConnectingIp = true;
		config.trustedProxyCidrs = '10.0.0.0/8';

		const ip = resolveClientIp(
			event({ 'cf-connecting-ip': '198.51.100.30' }, '10.0.0.10'),
			config
		);

		expect(ip).toBe('198.51.100.30');
	});

	test('falls back to the socket address for invalid forwarded values', () => {
		config.trustedProxyCidrs = '10.0.0.0/8';

		const ip = resolveClientIp(
			event({ 'x-forwarded-for': 'not-an-ip' }, '10.9.8.7'),
			config
		);

		expect(ip).toBe('10.9.8.7');
	});
});
