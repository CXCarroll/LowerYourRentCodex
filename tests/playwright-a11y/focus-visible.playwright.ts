import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const publicRoutes = ['/', '/search', '/learn'];

async function gotoOk(page: Page, route: string) {
	const response = await page.goto(route);
	expect(response?.ok(), `${route} should return a successful response`).toBe(true);
}

test.describe('accessibility smoke coverage', () => {
	test.describe.configure({ mode: 'serial' });

	for (const route of publicRoutes) {
		test(`${route} has no detectable axe violations`, async ({ page }) => {
			await gotoOk(page, route);
			await expect(page.locator('body')).toBeVisible();

			const accessibilityScanResults = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
				.analyze();

			expect(accessibilityScanResults.violations).toEqual([]);

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

		const accessibilityScanResults = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
			.analyze();

		expect(accessibilityScanResults.violations).toEqual([]);
	});
});
