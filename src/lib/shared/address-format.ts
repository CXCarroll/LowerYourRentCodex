// Address casing helpers shared by client + server.

/** Title-case a single word: first letter upper, rest lower. Preserves empty. */
export function titleCaseWord(w: string): string {
	if (!w) return w;
	const lower = w.toLowerCase();
	return lower[0].toUpperCase() + lower.slice(1);
}
