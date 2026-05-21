import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.A11Y_PORT ?? 4173);
const host = '127.0.0.1';
const baseURL = `http://${host}:${port}`;
const adminPasswordHash =
	process.env.ADMIN_PASSWORD_HASH ??
	'$argon2id$v=19$m=65536,t=3,p=1$StxhtxHMkIsybhnLYyM4+g$xXx00N/Uoeqt0sbdbMSsizJgF74Dhi/VDutZIvyay6w';

export default defineConfig({
	testDir: './tests/playwright-a11y',
	testMatch: /.*\.playwright\.ts/,
	fullyParallel: true,
	timeout: 45_000,
	expect: {
		timeout: 5_000
	},
	use: {
		...devices['Desktop Chrome'],
		baseURL,
		trace: 'retain-on-failure'
	},
	webServer: {
		command: `bun run build && bun run preview -- --host ${host} --port ${port}`,
		env: {
			ADMIN_PASSWORD_HASH: adminPasswordHash
		},
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
