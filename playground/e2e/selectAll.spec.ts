import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("[data-pen-inline-content]").first()).toBeVisible();
});

test("selects the full structured document on first cmd+a", async ({ page }) => {
	const firstInline = page.locator("[data-pen-inline-content]").first();

	await firstInline.click();
	await page.keyboard.type("First");
	await page.keyboard.press("Enter");
	await page.keyboard.type("Second");
	await page.keyboard.press("Enter");
	await page.keyboard.type("Third");

	await firstInline.click({ position: { x: 10, y: 10 } });

	await page.keyboard.press("ControlOrMeta+A");

	await expect
		.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? ""))
		.toBe("First\nSecond\nThird");
});

test("keeps database available in the structured playground slash menu", async ({
	page,
}) => {
	const firstInline = page.locator("[data-pen-inline-content]").first();

	await firstInline.click();
	await page.keyboard.press("/");

	const slashMenu = page.locator("[data-pen-slash-menu]");
	await expect(slashMenu).toBeVisible();
	await expect(slashMenu).toContainText("Database");
});
