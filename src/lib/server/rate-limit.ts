// In-process IP rate limiting (token bucket).
// A small per-process bucket to stop obvious abuse; Cloudflare edge rate
// limiting is the real defense in production.

interface Bucket {
	tokens: number;
	refilledAt: number;
}

const IP_BUCKET_CAPACITY = 10; // tokens
const IP_BUCKET_WINDOW_MS = 60_000; // refill to full each minute
const buckets = new Map<string, Bucket>();

export function consumeIpToken(ip: string): { ok: boolean; retryAfter: number } {
	const now = Date.now();
	const bucket = buckets.get(ip);
	if (!bucket) {
		buckets.set(ip, { tokens: IP_BUCKET_CAPACITY - 1, refilledAt: now });
		return { ok: true, retryAfter: 0 };
	}
	if (now - bucket.refilledAt >= IP_BUCKET_WINDOW_MS) {
		bucket.tokens = IP_BUCKET_CAPACITY;
		bucket.refilledAt = now;
	}
	if (bucket.tokens <= 0) {
		const retryAfter = Math.ceil((IP_BUCKET_WINDOW_MS - (now - bucket.refilledAt)) / 1000);
		return { ok: false, retryAfter: Math.max(1, retryAfter) };
	}
	bucket.tokens -= 1;
	return { ok: true, retryAfter: 0 };
}

export function getClientIp(request: Request, fallback = 'unknown'): string {
	// Behind Cloudflare, CF-Connecting-IP holds the true client IP and is set
	// only by Cloudflare's edge — trust it first. Absent in local dev.
	const cf = request.headers.get('cf-connecting-ip');
	if (cf) return cf.trim();
	// Otherwise trust only the rightmost X-Forwarded-For entry (set by our own proxy).
	const xff = request.headers.get('x-forwarded-for');
	if (xff) {
		const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
		if (parts.length > 0) return parts[parts.length - 1];
	}
	const real = request.headers.get('x-real-ip');
	if (real) return real.trim();
	return fallback;
}
