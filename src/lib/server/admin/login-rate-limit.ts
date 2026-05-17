// Dedicated IP token bucket for /admin/login POSTs.
// Tighter than the public /api bucket: 5 attempts per 10-minute window.
// Single-process, in-memory — sufficient for a single Railway instance.

interface Bucket {
	tokens: number;
	refilledAt: number;
}

const CAPACITY = 5;
const WINDOW_MS = 10 * 60 * 1000;
const buckets = new Map<string, Bucket>();

export function consumeLoginAttempt(ip: string): { ok: boolean; retryAfterSec: number } {
	const now = Date.now();
	const b = buckets.get(ip);
	if (!b) {
		buckets.set(ip, { tokens: CAPACITY - 1, refilledAt: now });
		return { ok: true, retryAfterSec: 0 };
	}
	if (now - b.refilledAt >= WINDOW_MS) {
		b.tokens = CAPACITY;
		b.refilledAt = now;
	}
	if (b.tokens <= 0) {
		const retryAfterSec = Math.max(1, Math.ceil((WINDOW_MS - (now - b.refilledAt)) / 1000));
		return { ok: false, retryAfterSec };
	}
	b.tokens -= 1;
	return { ok: true, retryAfterSec: 0 };
}

/** For tests. */
export function _resetLoginAttempts(): void {
	buckets.clear();
}
