// Address normalization with unit stripping.
// Uses `parse-address` when it can; regex fallback otherwise.
// Phase 1 does NOT require a ZIP-to-county lookup; we just need a building string + ZIP.
//
// Returns:
//   - `building`: display-ready street address (title-case with uppercase state abbrev),
//     no unit/apt/suite. This is what we show to the user in their email template.
//   - `addressHash`: sha256 of the canonical lowercased building — used for dedupe.

import { createHash } from 'node:crypto';
import { parseLocation } from 'parse-address';
import { titleCaseWord } from '$lib/shared/address-format';

const UNIT_PATTERN = /\b(apt|apartment|unit|ste|suite|fl|floor|#)\s*[\w-]+/gi;
const ZIP_PATTERN = /\b(\d{5})(-\d{4})?\b/;

export interface NormalizedAddress {
	building: string;
	zip: string | null;
	addressHash: string;
}

export function normalizeBuildingAddress(raw: string): NormalizedAddress {
	const trimmed = raw.trim();
	let parts: string[] = [];
	let state: string | null = null;
	let zip: string | null = null;

	try {
		const p = parseLocation(trimmed);
		if (p && p.number && p.street) {
			parts = [p.number, p.prefix, p.street, p.type, p.suffix, p.city]
				.filter(Boolean)
				.map((s) => String(s).trim().toLowerCase())
				.map(titleCaseWord);
			if (p.state) state = p.state.toUpperCase();
			if (p.zip) zip = p.zip.slice(0, 5);
		}
	} catch {
		// fall through to regex fallback
	}

	if (parts.length === 0) {
		// Fallback: strip units, tokenize, lightly title-case.
		const cleaned = trimmed.replace(UNIT_PATTERN, '').replace(/\s+/g, ' ').trim();
		for (const token of cleaned.split(/[\s,]+/)) {
			if (!token) continue;
			if (/^\d{5}(-\d{4})?$/.test(token)) {
				if (!zip) zip = token.slice(0, 5);
				continue;
			}
			if (/^[A-Za-z]{2}$/.test(token) && !state) {
				state = token.toUpperCase();
				continue;
			}
			parts.push(/^\d+$/.test(token) ? token : titleCaseWord(token));
		}
	}

	if (!zip) {
		const m = trimmed.match(ZIP_PATTERN);
		if (m) zip = m[1];
	}

	const display = [...parts, state, zip].filter(Boolean).join(' ');
	const building = display.replace(/\s+/g, ' ').trim();
	const addressHash = createHash('sha256').update(building.toLowerCase()).digest('hex');

	return { building, zip, addressHash };
}
