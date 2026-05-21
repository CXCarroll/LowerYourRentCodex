import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const publicRoutes = ['/', '/search', '/learn'];

async function gotoOk(page: Page, route: string) {
	const response = await page.goto(route);
	expect(response?.ok(), `${route} should return a successful response`).toBe(true);
}

async function scanPage(page: Page) {
	const accessibilityScanResults = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();

	expect(accessibilityScanResults.violations).toEqual([]);
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

test.describe('accessibility smoke coverage', () => {
	test.describe.configure({ mode: 'serial' });

	for (const route of publicRoutes) {
		test(`${route} has no detectable axe violations`, async ({ page }) => {
			await gotoOk(page, route);
			await expect(page.locator('body')).toBeVisible();

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

	test('/admin/login has no detectable axe violations', async ({ page }) => {
		await gotoOk(page, '/admin/login');
		await expect(page.locator('body')).toBeVisible();

		await scanPage(page);
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
