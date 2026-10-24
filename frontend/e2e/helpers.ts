import { Page, expect } from '@playwright/test';

export const TEST_PASSWORD = 'antigravity2026';
export const TEST_API_KEY = 'agy_sk_872060eaf2fd7c06000cdf04f5a1411444670efb27388ec9';

/**
 * Configure la session dans le localStorage avant le chargement de la page
 */
export async function setupAuthSession(page: Page, token = TEST_API_KEY) {
  await page.addInitScript((authToken) => {
    window.localStorage.setItem('antigravity_token', authToken);
    window.localStorage.setItem('antigravity_theme', 'dark');
    window.localStorage.setItem('antigravity_lang', 'fr');
  }, token);
}

/**
 * Effectue la connexion via l'interface du LoginModal
 */
export async function loginViaUI(page: Page, password = TEST_PASSWORD) {
  await page.goto('/');
  const passwordInput = page.locator('form input').first();
  await expect(passwordInput).toBeVisible({ timeout: 10000 });
  await passwordInput.fill(password);
  
  const submitButton = page.locator('button[type="submit"]');
  await submitButton.click();
  
  // Attendre la disparition du modal de connexion
  await expect(page.locator('button[type="submit"]')).not.toBeVisible({ timeout: 10000 });
}
