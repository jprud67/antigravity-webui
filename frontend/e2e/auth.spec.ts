import { test, expect } from '@playwright/test';
import { TEST_PASSWORD, TEST_API_KEY, setupAuthSession, loginViaUI } from './helpers';

test.describe('Authentication Flow', () => {
  test('devrait afficher le formulaire de connexion si non-authentifié', async ({ page }) => {
    // Vider les tokens
    await page.addInitScript(() => {
      window.localStorage.removeItem('antigravity_token');
    });

    await page.goto('/');

    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput).toBeVisible({ timeout: 10000 });

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled(); // Vide = désactivé
  });

  test('devrait afficher une erreur avec un mauvais mot de passe', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem('antigravity_token');
    });

    await page.goto('/');

    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput).toBeVisible({ timeout: 10000 });
    await passwordInput.fill('mauvais_mot_de_passe_123');

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Doit afficher un message d'erreur
    const errorAlert = page.locator('.animate-shake');
    await expect(errorAlert).toBeVisible({ timeout: 5000 });
  });

  test('devrait déverrouiller le cockpit avec le bon mot de passe', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem('antigravity_token');
    });

    await loginViaUI(page, TEST_PASSWORD);

    // Vérifier que le brand Antigravity est visible dans l'application
    const brand = page.locator('span', { hasText: 'Antigravity' }).first();
    await expect(brand).toBeVisible({ timeout: 10000 });

    // Vérifier que le token est sauvegardé dans le localStorage
    const storedToken = await page.evaluate(() => localStorage.getItem('antigravity_token'));
    expect(storedToken).toBeTruthy();
  });

  test('devrait charger directement le cockpit avec un token valide en localStorage', async ({ page }) => {
    await setupAuthSession(page, TEST_API_KEY);
    await page.goto('/');

    // Aucun modal de connexion ne doit être visible
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).not.toBeVisible({ timeout: 5000 });

    // L'interface principale est prête
    const brand = page.locator('span', { hasText: 'Antigravity' }).first();
    await expect(brand).toBeVisible();
  });
});
