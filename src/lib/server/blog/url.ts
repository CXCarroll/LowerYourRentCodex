const PUBLIC_URL_BASE = 'https://loweryourrent.local';

export function isSafePublicUrl(value: string): boolean {
	const normalized = value.trim().replace(/[\u0000-\u001F\u007F\s]+/g, '');
	if (!normalized || normalized.startsWith('//')) return false;

	try {
		const parsed = new URL(normalized, PUBLIC_URL_BASE);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

export function validateOptionalPublicImageUrl(value: string | null): string | null {
	if (value === null) return null;
	return isSafePublicUrl(value) ? value : null;
}
