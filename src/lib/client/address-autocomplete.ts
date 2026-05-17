// Browser client for the address-suggestion proxy.
//
// The geocoding provider (Mapbox) is hit server-side at /api/address/suggest so
// the Mapbox token and the user's IP stay off the client. This module just
// forwards the query and decodes the normalized response. All errors are
// swallowed → returns []; autocomplete is opportunistic and the free-typed
// address path still works.

export interface AddressCandidate {
	/** UI-ready, formatted address string. */
	display: string;
	/** 5-digit ZIP parsed out of the match, if present. */
	zip: string | null;
}

interface SuggestResponse {
	matches?: AddressCandidate[];
}

export async function suggestAddresses(
	query: string,
	signal?: AbortSignal
): Promise<AddressCandidate[]> {
	const url = `/api/address/suggest?q=${encodeURIComponent(query)}`;
	try {
		const res = await fetch(url, { signal });
		if (!res.ok) return [];
		const body = (await res.json()) as SuggestResponse;
		return body?.matches ?? [];
	} catch {
		return [];
	}
}
