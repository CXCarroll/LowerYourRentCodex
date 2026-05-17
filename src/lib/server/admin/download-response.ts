// Shared response helpers for the /admin/download/* endpoints. The key goal:
// *every* response from these endpoints must be a valid .csv attachment — never
// an HTML error page — so that a browser's `<a download>` click always saves a
// .csv file. When something goes wrong, the CSV body is a machine-readable
// block of comment lines describing exactly what failed and what to try.

function csvHeaders(filename: string): Headers {
	const h = new Headers();
	h.set('content-type', 'text/csv; charset=utf-8');
	h.set('content-disposition', `attachment; filename="${filename}"`);
	h.set('cache-control', 'no-store');
	return h;
}

export function csvResponse(filename: string, body: string): Response {
	return new Response(body, { status: 200, headers: csvHeaders(filename) });
}

/**
 * Build a CSV-shaped error "file" so the browser still saves a .csv attachment.
 * Body is a block of lines prefixed with `#` — parseable by humans in any text
 * editor, and ignored by spreadsheet apps as comments.
 */
export function csvErrorResponse(
	filenameStem: string,
	status: number,
	lines: string[]
): Response {
	const header = [
		'# LowerYourRent admin download — ERROR',
		`# Status: ${status}`,
		`# Timestamp: ${new Date().toISOString()}`,
		'#'
	];
	const body = [...header, ...lines.map((l) => `# ${l}`), ''].join('\n');
	return new Response(body, {
		status,
		headers: csvHeaders(`${filenameStem}.csv`)
	});
}
