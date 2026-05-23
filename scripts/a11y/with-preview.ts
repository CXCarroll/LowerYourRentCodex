import postgres from 'postgres';

const args = Bun.argv.slice(2).filter((arg) => arg !== '--');

if (args.length === 0) {
	console.error('Usage: bun run scripts/a11y/with-preview.ts -- <command> [...args]');
	process.exit(1);
}

const host = '127.0.0.1';
const port = Number(process.env.A11Y_PORT ?? 4173);
const baseURL = `http://${host}:${port}`;
const adminPasswordHash =
	Bun.env.ADMIN_PASSWORD_HASH ??
	'$argon2id$v=19$m=65536,t=3,p=1$StxhtxHMkIsybhnLYyM4+g$xXx00N/Uoeqt0sbdbMSsizJgF74Dhi/VDutZIvyay6w';
const blogA11ySlug = 'a11y-markdown-fixture';

async function run(command: string[], label: string) {
	const child = Bun.spawn(command, {
		stdout: 'inherit',
		stderr: 'inherit'
	});
	const code = await child.exited;
	if (code !== 0) {
		throw new Error(`${label} failed with exit code ${code}`);
	}
}

async function waitForServer() {
	const started = Date.now();
	let lastError: unknown;
	while (Date.now() - started < 30_000) {
		try {
			const response = await fetch(baseURL);
			if (response.ok) return;
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await Bun.sleep(500);
	}
	throw new Error(`Timed out waiting for ${baseURL}: ${String(lastError)}`);
}

async function seedA11yFixtures() {
	const databaseUrl = Bun.env.DATABASE_URL;
	if (!databaseUrl) return;

	const sql = postgres(databaseUrl, { max: 1, idle_timeout: 1 });
	try {
		await sql`
			insert into blog_posts (
				slug,
				title,
				excerpt,
				cover_image_url,
				content,
				status,
				published_at,
				updated_at
			)
			values (
				${blogA11ySlug},
				'Accessibility markdown fixture',
				'Fixture article for accessibility checks.',
				null,
				${`# Renewal overview

Body copy before the image.

![Tenant reviewing a lease renewal letter](/favicon.png)

## Compare nearby rents

More body copy.`},
				'published',
				now(),
				now()
			)
			on conflict (slug) do update set
				title = excluded.title,
				excerpt = excluded.excerpt,
				cover_image_url = excluded.cover_image_url,
				content = excluded.content,
				status = excluded.status,
				published_at = excluded.published_at,
				updated_at = excluded.updated_at
		`;
	} finally {
		await sql.end({ timeout: 1 });
	}
}

await run(['bun', 'run', 'build'], 'build');
await seedA11yFixtures();

const preview = Bun.spawn(
	['bun', 'run', 'preview', '--', '--host', host, '--port', String(port)],
	{
		env: {
			...Bun.env,
			ADMIN_PASSWORD_HASH: adminPasswordHash
		},
		stdout: 'inherit',
		stderr: 'inherit'
	}
);

try {
	await waitForServer();
	await run(args, args[0]);
} finally {
	preview.kill();
	await preview.exited.catch(() => {});
}
