import { isIP } from 'node:net';

export interface ClientAddressEvent {
	request: Request;
	getClientAddress?: () => string;
}

export interface ClientIpConfig {
	trustCfConnectingIp?: boolean;
	trustedProxyCidrs?: string;
}

function normalizeIp(value: string | null | undefined): string | null {
	if (!value) return null;
	let ip = value.trim();
	if (!ip) return null;

	if (ip.startsWith('[')) {
		const end = ip.indexOf(']');
		if (end > 0) ip = ip.slice(1, end);
	} else {
		const ipv4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
		if (ipv4WithPort) ip = ipv4WithPort[1];
	}

	return isIP(ip) ? ip : null;
}

function parseTrustedCidrs(config: ClientIpConfig): string[] {
	return (config.trustedProxyCidrs ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

function ipv4ToBigInt(ip: string): bigint | null {
	const parts = ip.split('.');
	if (parts.length !== 4) return null;
	let n = 0n;
	for (const part of parts) {
		const value = Number(part);
		if (!Number.isInteger(value) || value < 0 || value > 255) return null;
		n = (n << 8n) + BigInt(value);
	}
	return n;
}

function ipv6ToBigInt(ip: string): bigint | null {
	if (ip.includes('.')) {
		const lastColon = ip.lastIndexOf(':');
		const ipv4 = ipv4ToBigInt(ip.slice(lastColon + 1));
		if (ipv4 === null) return null;
		const high = ((ipv4 >> 16n) & 0xffffn).toString(16);
		const low = (ipv4 & 0xffffn).toString(16);
		ip = `${ip.slice(0, lastColon)}:${high}:${low}`;
	}

	const halves = ip.split('::');
	if (halves.length > 2) return null;
	const left = halves[0] ? halves[0].split(':') : [];
	const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	const missing = 8 - left.length - right.length;
	if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
	const groups = [...left, ...Array(missing).fill('0'), ...right];
	if (groups.length !== 8) return null;

	let n = 0n;
	for (const group of groups) {
		if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
		n = (n << 16n) + BigInt(Number.parseInt(group, 16));
	}
	return n;
}

function ipToBigInt(ip: string): { version: 4 | 6; value: bigint } | null {
	const version = isIP(ip);
	if (version === 4) {
		const value = ipv4ToBigInt(ip);
		return value === null ? null : { version, value };
	}
	if (version === 6) {
		const value = ipv6ToBigInt(ip);
		return value === null ? null : { version, value };
	}
	return null;
}

function cidrContains(cidr: string, ip: string): boolean {
	const [rawBase, rawPrefix] = cidr.includes('/') ? cidr.split('/') : [cidr, undefined];
	const base = normalizeIp(rawBase);
	if (!base) return false;
	const target = ipToBigInt(ip);
	const source = ipToBigInt(base);
	if (!target || !source || target.version !== source.version) return false;

	const bits = source.version === 4 ? 32 : 128;
	const prefix = rawPrefix === undefined ? bits : Number(rawPrefix);
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return false;
	if (prefix === 0) return true;

	const shift = BigInt(bits - prefix);
	return target.value >> shift === source.value >> shift;
}

function isTrustedProxy(ip: string | null, config: ClientIpConfig): boolean {
	if (!ip) return false;
	return parseTrustedCidrs(config).some((cidr) => cidrContains(cidr, ip));
}

function firstHeaderIp(value: string | null): string | null {
	if (!value) return null;
	return normalizeIp(value.split(',')[0]);
}

export function resolveClientIp(
	event: ClientAddressEvent,
	config: ClientIpConfig,
	fallback = 'unknown'
): string {
	const socketIp = normalizeIp(event.getClientAddress?.());

	if (config.trustCfConnectingIp && isTrustedProxy(socketIp, config)) {
		const cf = normalizeIp(event.request.headers.get('cf-connecting-ip'));
		if (cf) return cf;
	}

	if (isTrustedProxy(socketIp, config)) {
		const xff = event.request.headers
			.get('x-forwarded-for')
			?.split(',')
			.map((part) => normalizeIp(part))
			.filter((part): part is string => !!part);
		if (xff && xff.length > 0) {
			for (let i = xff.length - 1; i >= 0; i -= 1) {
				if (!isTrustedProxy(xff[i], config)) return xff[i];
			}
			return xff[0];
		}

		const real = firstHeaderIp(event.request.headers.get('x-real-ip'));
		if (real) return real;
	}

	return socketIp ?? fallback;
}
