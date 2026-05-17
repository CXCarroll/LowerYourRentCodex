export function formatCentsAsDollars(cents: number): string {
	const dollars = Math.round(cents / 100);
	return dollars.toLocaleString('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	});
}

export function parseDollarStringToCents(raw: string): number | null {
	const cleaned = raw.replace(/[^\d.]/g, '');
	if (!cleaned) return null;
	const dollars = Number(cleaned);
	if (!Number.isFinite(dollars)) return null;
	return Math.round(dollars * 100);
}
