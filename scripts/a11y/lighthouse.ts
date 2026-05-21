const host = '127.0.0.1';
const port = Number(process.env.A11Y_PORT ?? 4173);
const baseURL = `http://${host}:${port}`;
const routes = ['/', '/search', '/learn', '/admin/login'];
const minScore = Number(process.env.LIGHTHOUSE_A11Y_MIN_SCORE ?? 0.95);
const reportDir = '.cache/lighthouse-a11y';

await Bun.$`mkdir -p ${reportDir}`;

function routeName(route: string) {
	return route === '/' ? 'root' : route.replace(/^\/+/, '').replace(/\//g, '-');
}

for (const route of routes) {
	const url = `${baseURL}${route}`;
	const outputPath = `${reportDir}/${routeName(route)}.json`;
	const child = Bun.spawn(
		[
			'lighthouse',
			url,
			'--only-categories=accessibility',
			'--preset=desktop',
			'--quiet',
			'--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage',
			'--output=json',
			`--output-path=${outputPath}`
		],
		{ stdout: 'inherit', stderr: 'inherit' }
	);
	const code = await child.exited;
	if (code !== 0) process.exit(code);

	const report = await Bun.file(outputPath).json();
	const score = report.categories?.accessibility?.score;
	if (typeof score !== 'number') {
		throw new Error(`Lighthouse did not return an accessibility score for ${route}`);
	}
	if (score < minScore) {
		throw new Error(
			`Lighthouse accessibility score for ${route} was ${score}; expected at least ${minScore}`
		);
	}
	console.log(`${route}: Lighthouse accessibility score ${score}`);
}
