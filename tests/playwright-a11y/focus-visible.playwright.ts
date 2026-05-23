import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

const publicRoutes = ['/', '/search', '/learn'];
const adminA11yPassword = process.env.ADMIN_A11Y_PASSWORD ?? 'a11y-admin-password';
const adminExploreZip = '99501';
const blogA11ySlug = 'a11y-markdown-fixture';

async function gotoOk(page: Page, route: string) {
	const response = await page.goto(route);
	expect(response?.ok(), `${route} should return a successful response`).toBe(true);
}

async function scanPage(page: Page, disabledRules: string[] = []) {
	let builder = new AxeBuilder({ page }).withTags([
		'wcag2a',
		'wcag2aa',
		'wcag21a',
		'wcag21aa',
		'wcag22aa'
	]);
	for (const rule of disabledRules) builder = builder.disableRules([rule]);

	const accessibilityScanResults = await builder.analyze();

	expect(accessibilityScanResults.violations).toEqual([]);
}

async function expectNoRunningAnimation(page: Page, selector: string) {
	await expect(page.locator(selector).first()).toBeAttached();
	await expect
		.poll(async () =>
			page.locator(selector).first().evaluate((el) => {
				const style = window.getComputedStyle(el);
				return {
					animationName: style.animationName,
					animationDuration: style.animationDuration
				};
			})
		)
		.toEqual({ animationName: 'none', animationDuration: '0s' });
}

async function fillValidSubmissionFields(page: Page) {
	await page.locator('#lyr-address').fill('123 Main St, Brooklyn NY 11201');
	await page.locator('#lyr-rent').fill('2500');
	await page.locator('#lyr-lease').fill('2099-12-31');
}

async function submitRentForm(page: Page) {
	await page.getByRole('button', { name: /lower my rent/i }).click();
}

async function expectAssociatedError(page: Page, selector: string, errorId: string) {
	const control = page.locator(selector);
	const error = page.locator(`#${errorId}`);

	await expect(error).toBeVisible();
	await expect(error).not.toBeEmpty();
	await expect(control).toHaveAttribute('aria-invalid', 'true');
	await expect(control).toHaveAttribute('aria-describedby', new RegExp(`(^|\\s)${errorId}(\\s|$)`));
	await expect(control).toHaveAttribute('aria-errormessage', errorId);
}

async function mockAddressSuggestions(page: Page) {
	await page.route('**/api/address/suggest**', async (route) => {
		await route.fulfill({
			json: {
				matches: [
					{ display: '123 Main Street, Brooklyn, NY 11201', zip: '11201' },
					{ display: '123 Main Avenue, Brooklyn, NY 11201', zip: '11201' },
					{ display: '123 Main Road, Brooklyn, NY 11201', zip: '11201' }
				]
			}
		});
	});
}

async function mockSuccessfulVerification(page: Page) {
	await page.route('**/api/verify/send', async (route) => {
		await route.fulfill({ json: { ok: true } });
	});
	await page.route('**/api/verify/check', async (route) => {
		await route.fulfill({
			json: {
				versions: [
					{ body: 'First generated negotiation email.', reductionCents: 10_000 },
					{ body: 'Second generated negotiation email.', reductionCents: 20_000 }
				]
			}
		});
	});
}

async function loginAsAdmin(page: Page, next = '/admin/explore') {
	await gotoOk(page, `/admin/login?next=${encodeURIComponent(next)}`);
	await page.locator('#password').fill(adminA11yPassword);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(new RegExp(`${next}$`));
}

async function seedAdminExploreZip() {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) return;

	const sql = postgres(databaseUrl, { max: 1, idle_timeout: 1 });
	try {
		await sql`
			insert into zip_county (zip, county_fips, cbsa_code)
			values (${adminExploreZip}, '02020', null)
			on conflict (zip) do update set
				county_fips = excluded.county_fips,
				cbsa_code = excluded.cbsa_code
		`;
		await sql`
			insert into zip_centroids (zip, lat, lng)
			values (${adminExploreZip}, '61.217600', '-149.899700')
			on conflict (zip) do update set
				lat = excluded.lat,
				lng = excluded.lng
		`;
		await sql`
			insert into hud_fmr (year, county_fips, apt_type, fmr_cents)
			values
				(2024, '02020', 'studio', 110000),
				(2025, '02020', 'studio', 115000),
				(2024, '02020', '1br', 125000),
				(2025, '02020', '1br', 132500),
				(2024, '02020', '2br', 150000),
				(2025, '02020', '2br', 158000)
			on conflict (year, county_fips, apt_type) do update set
				fmr_cents = excluded.fmr_cents
		`;
	} finally {
		await sql.end({ timeout: 1 });
	}
}

async function seedPublishedBlogPost() {
	const databaseUrl = process.env.DATABASE_URL;
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

test.describe('accessibility smoke coverage', () => {
	test.describe.configure({ mode: 'serial' });

	for (const route of publicRoutes) {
		test(`${route} has no detectable axe violations`, async ({ page }) => {
			await gotoOk(page, route);
			await expect(page.locator('body')).toBeVisible();

			await expect(page.locator('main h1').first()).toHaveAttribute('tabindex', '-1');
			await scanPage(page);

			if (route === '/') {
				await expect(page.locator('#lyr-address')).toHaveAccessibleName('Address');
				await expect(page.locator('#lyr-apartment')).toHaveAccessibleName('Apartment');
				await expect(page.locator('#lyr-rent')).toHaveAccessibleName('Current rent');
				await expect(page.locator('#lyr-lease')).toHaveAccessibleName('Lease ends');
				await expect(page.locator('#lyr-email')).toHaveAccessibleName('Email');
			}
		});
	}

	test('SPA route changes focus the new h1 and update the live region', async ({ page }) => {
		await gotoOk(page, '/');

		const liveRegion = page.locator('#route-announcer');
		await expect(liveRegion).toBeAttached();

		await page.getByRole('link', { name: 'Learn' }).click();
		await expect(page.getByRole('heading', { name: 'Negotiate smarter.' })).toBeVisible();
		await expect
			.poll(async () =>
				page.evaluate(() => document.activeElement?.textContent?.replace(/\s+/g, ' ').trim())
			)
			.toBe('Negotiate smarter.');
		await expect(liveRegion).toHaveText('Navigated to Negotiate smarter.');

		await scanPage(page);

		await page.getByRole('link', { name: 'Search' }).click();
		await expect(page.getByRole('heading', { name: 'Find a fair rent.' })).toBeVisible();
		await expect
			.poll(async () =>
				page.evaluate(() => document.activeElement?.textContent?.replace(/\s+/g, ' ').trim())
			)
			.toBe('Find a fair rent.');
		await expect(liveRegion).toHaveText('Navigated to Find a fair rent.');

		await scanPage(page);
	});

	test('primary navigation is exposed as links with the current page marked', async ({ page }) => {
		for (const route of publicRoutes) {
			await gotoOk(page, route);

			const primaryNav = page.getByRole('navigation', { name: 'Primary' });
			await expect(primaryNav).toBeVisible();

			await expect(primaryNav.getByRole('link', { name: 'Negotiate' })).toHaveAttribute(
				'href',
				'/'
			);
			await expect(primaryNav.getByRole('link', { name: 'Learn' })).toHaveAttribute(
				'href',
				'/learn'
			);
			await expect(primaryNav.getByRole('link', { name: 'Search' })).toHaveAttribute(
				'href',
				'/search'
			);

			const currentName = route === '/learn' ? 'Learn' : route === '/search' ? 'Search' : 'Negotiate';
			await expect(primaryNav.getByRole('link', { name: currentName })).toHaveAttribute(
				'aria-current',
				'page'
			);
		}
	});

	test('published blog article preserves heading hierarchy and image names', async ({ page }) => {
		test.skip(!process.env.DATABASE_URL, 'Blog article route checks require DATABASE_URL.');
		await seedPublishedBlogPost();

		await gotoOk(page, `/learn/${blogA11ySlug}`);
		await expect(page.locator('body')).toBeVisible();

		await expect(page.locator('main h1')).toHaveCount(1);
		await expect(page.locator('.blog-prose h1')).toHaveCount(0);
		await expect(page.getByRole('heading', { level: 2, name: 'Renewal overview' })).toBeVisible();
		await expect(
			page.getByRole('heading', { level: 3, name: 'Compare nearby rents' })
		).toBeVisible();
		await expect(
			page.getByRole('img', { name: 'Tenant reviewing a lease renewal letter' })
		).toBeVisible();

		await scanPage(page);
	});

	test('segmented selectors expose native radio groups', async ({ page }) => {
		await gotoOk(page, '/');

		const apartmentType = page.getByRole('group', { name: 'Apartment type' });
		await expect(apartmentType).toBeVisible();
		await expect(apartmentType.getByRole('radio', { name: '1 BR' })).toBeChecked();

		await apartmentType.getByRole('radio', { name: 'Studio' }).check();
		await expect(apartmentType.getByRole('radio', { name: 'Studio' })).toBeChecked();

		await scanPage(page);
	});

	test('email version picker exposes a named radio group after verification', async ({ page }) => {
		await mockSuccessfulVerification(page);
		await gotoOk(page, '/');
		await fillValidSubmissionFields(page);
		await page.locator('#lyr-email').fill('tenant@example.com');
		await submitRentForm(page);

		await expect(page.locator('#lyr-otp-label')).toBeVisible();
		await page.locator('.lyr-otp-input').first().click();
		await page.keyboard.type('123456');

		const emailVersion = page.getByRole('group', { name: 'Email version' });
		await expect(emailVersion).toBeVisible();
		await expect(emailVersion.getByRole('radio', { name: /\$100\/mo/ })).toBeChecked();

		await emailVersion.getByRole('radio', { name: /\$200\/mo/ }).check();
		await expect(emailVersion.getByRole('radio', { name: /\$200\/mo/ })).toBeChecked();

		await scanPage(page);
	});

	test('keyboard traversal exposes a visible focus indicator on the homepage', async ({ page }) => {
		await gotoOk(page, '/');

		const focusedIndicators: string[] = [];
		for (let i = 0; i < 12; i += 1) {
			await page.keyboard.press('Tab');
			const indicator = await page.evaluate(() => {
				function hasIndicator(element: Element | null | undefined) {
					if (!element || element === document.body) return false;
					const style = window.getComputedStyle(element);
					const outlineWidth = Number.parseFloat(style.outlineWidth || '0');
					const hasOutline = style.outlineStyle !== 'none' && outlineWidth >= 2;
					const hasShadow = style.boxShadow !== 'none';
					return hasOutline || hasShadow;
				}

				const active = document.activeElement;
				const candidates = [active, active?.parentElement, active?.parentElement?.parentElement];
				const visible = candidates.some(hasIndicator);
				const label =
					active?.getAttribute('aria-label') ||
					active?.textContent?.trim() ||
					active?.getAttribute('name') ||
					active?.tagName ||
					'unknown';

				return { label, visible };
			});

			if (indicator.visible) focusedIndicators.push(indicator.label);
		}

		expect(focusedIndicators.length).toBeGreaterThan(0);
	});

	test('homepage address autocomplete follows the ARIA combobox pattern', async ({ page }) => {
		await mockAddressSuggestions(page);
		await gotoOk(page, '/');

		const input = page.locator('#lyr-address');
		await input.fill('123 Main');

		await expect(input).toHaveAttribute('role', 'combobox');
		await expect(input).toHaveAttribute('aria-autocomplete', 'list');
		await expect(input).toHaveAttribute('aria-haspopup', 'listbox');
		await expect(input).toHaveAttribute('aria-expanded', 'true');

		const listboxId = await input.getAttribute('aria-controls');
		expect(listboxId).toBeTruthy();
		const listbox = page.locator(`[id="${listboxId}"]`);
		await expect(listbox).toHaveAttribute('role', 'listbox');

		const options = listbox.locator(':scope > [role="option"]');
		await expect(options).toHaveCount(3);
		await expect(listbox.locator('[role="option"] button')).toHaveCount(0);

		const firstActive = await input.getAttribute('aria-activedescendant');
		expect(firstActive).toBeTruthy();
		await expect(page.locator(`[id="${firstActive}"]`)).toHaveAttribute('role', 'option');

		await page.keyboard.press('ArrowDown');
		const secondActive = await input.getAttribute('aria-activedescendant');
		expect(secondActive).toBeTruthy();
		expect(secondActive).not.toBe(firstActive);
		await expect(page.locator(`[id="${secondActive}"]`)).toHaveAttribute('aria-selected', 'true');

		await page.keyboard.press('ArrowUp');
		await expect(input).toHaveAttribute('aria-activedescendant', firstActive as string);

		await page.keyboard.press('Escape');
		await expect(input).toHaveAttribute('aria-expanded', 'false');
		await expect(input).not.toHaveAttribute('aria-activedescendant', /.*/);

		await input.fill('123 Main S');
		await expect(input).toHaveAttribute('aria-expanded', 'true');
		await page.keyboard.press('Enter');
		await expect(input).toHaveValue('123 Main Street, Brooklyn, NY 11201');
		await expect(input).toHaveAttribute('aria-expanded', 'false');

		await scanPage(page);
	});

	test('/admin/login has no detectable axe violations', async ({ page }) => {
		await gotoOk(page, '/admin/login');
		await expect(page.locator('body')).toBeVisible();

		await scanPage(page);
	});

	test.describe('admin ZIP explorer map accessibility', () => {
		test.skip(!process.env.DATABASE_URL, 'Authenticated admin route checks require DATABASE_URL.');

		test.beforeEach(async () => {
			await seedAdminExploreZip();
		});

		test('/admin exposes a named submissions chart and data table alternative', async ({ page }) => {
			await loginAsAdmin(page, '/admin');

			const chart = page.getByRole('img', { name: /Submissions — last 30 days/ });
			await expect(chart).toBeVisible();
			await expect(chart.locator('title')).toHaveText('Submissions — last 30 days');
			await expect(chart.locator('desc')).toContainText('Full data is available in the table below');

			await page.getByText('View Submissions — last 30 days data').click();
			const chartData = page.getByRole('table', { name: 'Submissions — last 30 days data' });
			await expect(chartData).toBeVisible();
			await expect(chartData.getByRole('columnheader', { name: 'Date' })).toBeVisible();
			await expect(chartData.getByRole('columnheader', { name: 'Submissions' })).toBeVisible();

			await scanPage(page);
		});

		test('/admin/explore exposes a named map and marker table alternative', async ({ page }) => {
			await loginAsAdmin(page);

			const map = page.locator('[aria-label="ZIP code marker map"]');
			await expect(map).toBeVisible();
			await expect(map).toHaveAccessibleName('ZIP code marker map');
			await expect(map).toHaveAttribute('aria-describedby', /\bzip-map-keyboard-instructions\b/);
			await expect(page.locator('#zip-map-keyboard-instructions')).toContainText(
				'arrow keys to pan'
			);
			await expect(map.locator('xpath=following-sibling::*[1]')).toContainText('ZIP markers');
			await expect(page.getByText('No ZIP markers plotted yet.')).toBeVisible();

			await page.getByRole('textbox', { name: 'ZIP code' }).fill(adminExploreZip);
			await page.getByRole('button', { name: 'Look up' }).click();

			const markerTable = page.getByRole('table', {
				name: 'ZIP code markers plotted on the map'
			});
			await expect(markerTable).toBeVisible();
			await expect(markerTable.getByRole('row', { name: /99501/ })).toContainText('No rent data');
			await expect(markerTable.getByRole('cell', { name: '61.218' })).toBeVisible();
			await expect(markerTable.getByRole('cell', { name: '-149.900' })).toBeVisible();

			await scanPage(page);
		});

		test('/admin/explore exposes accessible FMR chart data and non-color series cues', async ({
			page
		}) => {
			await loginAsAdmin(page);

			await page.getByRole('textbox', { name: 'ZIP code' }).fill(adminExploreZip);
			await page.getByRole('button', { name: 'Look up' }).click();

			const chart = page.getByRole('img', { name: /HUD FMR history by apartment type/ });
			await expect(chart).toBeVisible();
			await expect(chart.locator('title')).toHaveText('HUD FMR history by apartment type');
			await expect(chart.locator('desc')).toContainText('distinct line pattern');

			const patternedSeries = chart.locator('path[stroke-dasharray]');
			await expect(patternedSeries).toHaveCount(2);

			await expect(page.getByText('Studio', { exact: true })).toBeVisible();
			await expect(page.getByText('1 BR', { exact: true })).toBeVisible();
			await expect(page.getByText('2 BR', { exact: true })).toBeVisible();
			await expect(page.locator('svg[aria-hidden="true"] line[stroke-dasharray]')).toHaveCount(2);

			await page.getByText('View HUD FMR history by apartment type data').click();
			const chartData = page.getByRole('table', {
				name: 'HUD FMR history by apartment type data'
			});
			await expect(chartData).toBeVisible();
			await expect(chartData.getByRole('columnheader', { name: 'Year' })).toBeVisible();
			await expect(chartData.getByRole('columnheader', { name: 'Studio' })).toBeVisible();
			await expect(chartData.getByRole('columnheader', { name: '1 BR' })).toBeVisible();
			await expect(chartData.getByRole('columnheader', { name: '2 BR' })).toBeVisible();
			await expect(chartData.getByRole('row', { name: /2024/ })).toContainText('$1,100');
			await expect(chartData.getByRole('row', { name: /2025/ })).toContainText('$1,580');

			await scanPage(page);
		});

		test('/admin/blog editor warns on bad image alt text and blocks publishing', async ({ page }) => {
			await loginAsAdmin(page, '/admin/blog/new');

			await page.locator('#post-title').fill(`Alt text fixture ${Date.now()}`);
			await page.locator('#post-content').fill(`Draft body.

![image](/favicon.png)
`);

			await expect(page.locator('#post-content-a11y')).toContainText(
				'Image alt text should describe the specific image'
			);
			await page.getByRole('button', { name: 'Create draft' }).click();
			await expect(page).toHaveURL(/\/admin\/blog\/[^/]+\/edit$/);

			await page.getByRole('button', { name: 'Publish' }).click();
			await expect(page.getByText('Fix Markdown image alt text before publishing.')).toBeVisible();
			await expect(page.locator('#post-content')).toHaveAttribute('aria-invalid', 'true');

			await page.locator('#post-content').fill(`Draft body.

![Tenant reviewing a lease renewal letter](/favicon.png)
`);
			await expect(page.locator('#post-content-a11y')).not.toContainText(
				'Image alt text should describe the specific image'
			);

			await page.getByRole('button', { name: 'Publish' }).click();
			await expect(page.getByRole('link', { name: /View on \/learn/ })).toBeVisible();
			await scanPage(page);
		});
	});

	test.describe('reduced-motion alternatives', () => {
		test.beforeEach(async ({ page }) => {
			await page.emulateMedia({ reducedMotion: 'reduce' });
		});

		for (const route of [...publicRoutes, '/admin/login']) {
			test(`${route} has no detectable axe violations with reduced motion`, async ({ page }) => {
				await gotoOk(page, route);
				await expect(page.locator('body')).toBeVisible();

				await scanPage(page, ['color-contrast']);
			});
		}

		test('homepage backdrop and loading spinner do not animate', async ({ page }) => {
			await page.route('**/api/verify/send', async (route) => {
				await new Promise((resolve) => setTimeout(resolve, 800));
				await route.fulfill({ json: { ok: true } });
			});

			await gotoOk(page, '/');
			await expectNoRunningAnimation(page, '.lyr-backdrop-orb');

			await fillValidSubmissionFields(page);
			await page.locator('#lyr-email').fill('tenant@example.com');
			await submitRentForm(page);

			await expect(page.locator('.lyr-spinner')).toBeVisible();
			await expectNoRunningAnimation(page, '.lyr-spinner');
		});

		test('route changes keep focus and live-region behavior without slide motion', async ({ page }) => {
			await gotoOk(page, '/');

			const liveRegion = page.locator('#route-announcer');
			await page.getByRole('link', { name: 'Learn' }).click();
			await expect(page.getByRole('heading', { name: 'Negotiate smarter.' })).toBeVisible();
			await expect
				.poll(async () =>
					page.evaluate(() => document.activeElement?.textContent?.replace(/\s+/g, ' ').trim())
				)
				.toBe('Negotiate smarter.');
			await expect(liveRegion).toHaveText('Navigated to Negotiate smarter.');
			await expect
				.poll(async () =>
					page
						.locator('main > div.grid > div')
						.first()
						.evaluate((el) => window.getComputedStyle(el).transitionDuration)
				)
				.toBe('0s');
		});

		test('generated email and version switches render immediately', async ({ page }) => {
			await mockSuccessfulVerification(page);
			await gotoOk(page, '/');
			await fillValidSubmissionFields(page);
			await page.locator('#lyr-email').fill('tenant@example.com');
			await submitRentForm(page);

			await expect(page.locator('#lyr-otp-label')).toBeVisible();
			await page.locator('.lyr-otp-input').first().click();
			await page.keyboard.type('123456');

			await expect(page.locator('textarea')).toHaveValue('First generated negotiation email.');

			const emailVersion = page.getByRole('group', { name: 'Email version' });
			await emailVersion.getByRole('radio', { name: /\$200\/mo/ }).check();
			await expect(page.locator('textarea')).toHaveValue('Second generated negotiation email.');
		});
	});

	test.describe('homepage error association', () => {
		test('associates client-side address, rent, lease, and email errors', async ({ page }) => {
			await gotoOk(page, '/');

			await submitRentForm(page);
			await expectAssociatedError(page, '#lyr-address', 'lyr-address-error');
			await scanPage(page);

			await page.locator('#lyr-address').fill('123 Main St, Brooklyn NY 11201');
			await submitRentForm(page);
			await expectAssociatedError(page, '#lyr-rent', 'lyr-rent-error');
			await scanPage(page);

			await page.locator('#lyr-rent').fill('2500');
			await submitRentForm(page);
			await expectAssociatedError(page, '#lyr-lease', 'lyr-lease-error');
			await scanPage(page);

			await page.locator('#lyr-lease').fill('2099-12-31');
			await submitRentForm(page);
			await expectAssociatedError(page, '#lyr-email', 'lyr-email-error');
			await scanPage(page);
		});

		test('announces and associates OTP errors from the verification step', async ({ page }) => {
			await page.route('**/api/verify/send', async (route) => {
				await route.fulfill({ json: { ok: true } });
			});
			await page.route('**/api/verify/check', async (route) => {
				await route.fulfill({ status: 401, json: { versions: [], error: 'invalid_code' } });
			});

			await gotoOk(page, '/');
			await fillValidSubmissionFields(page);
			await page.locator('#lyr-email').fill('tenant@example.com');
			await submitRentForm(page);

			await expect(page.locator('#lyr-otp-label')).toBeVisible();
			await page.locator('.lyr-otp-input').first().click();
			await page.keyboard.type('123456');

			const otpError = page.locator('#lyr-otp-error');
			await expect(otpError).toBeVisible();
			await expect(otpError).toHaveAttribute('role', 'alert');
			await expect(otpError).toHaveAttribute('aria-live', 'assertive');
			await expect(otpError).toHaveAttribute('aria-atomic', 'true');

			for (const input of await page.locator('.lyr-otp-input').all()) {
				await expect(input).toHaveAttribute('aria-invalid', 'true');
				await expect(input).toHaveAttribute('aria-describedby', /(^|\s)lyr-otp-error(\s|$)/);
				await expect(input).toHaveAttribute('aria-errormessage', 'lyr-otp-error');
			}
			await scanPage(page);
		});

		test('associates server-returned address errors after code verification', async ({ page }) => {
			await page.route('**/api/verify/send', async (route) => {
				await route.fulfill({ json: { ok: true } });
			});
			await page.route('**/api/verify/check', async (route) => {
				await route.fulfill({ status: 422, json: { versions: [], error: 'address_not_found' } });
			});

			await gotoOk(page, '/');
			await fillValidSubmissionFields(page);
			await page.locator('#lyr-email').fill('tenant@example.com');
			await submitRentForm(page);

			await expect(page.locator('#lyr-otp-label')).toBeVisible();
			await page.locator('.lyr-otp-input').first().click();
			await page.keyboard.type('123456');

			await expectAssociatedError(page, '#lyr-address', 'lyr-address-error');
			await scanPage(page);
		});
	});
});
