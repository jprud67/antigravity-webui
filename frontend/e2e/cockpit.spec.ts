import { test, expect } from '@playwright/test';
import { setupAuthSession, TEST_API_KEY } from './helpers';

test.describe('Cockpit & Interface Principale', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthSession(page, TEST_API_KEY);
    await page.goto('/');
  });

  test('affiche le cockpit complet avec la barre latérale et la zone de chat', async ({ page }) => {
    // Vérifier la présence de la marque Antigravity
    const brand = page.locator('span', { hasText: 'Antigravity' }).first();
    await expect(brand).toBeVisible({ timeout: 10000 });

    // Vérifier la présence du champ de saisie prompt
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();

    // Vérifier le bouton de nouvelle session
    const newSessionLink = page.locator('a[href="/"]');
    await expect(newSessionLink).toBeVisible();
  });

  test('permet de saisir du texte dans le composer de chat', async ({ page }) => {
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 10000 });

    const promptText = 'Bonjour Antigravity, vérification Playwright';
    await textarea.fill(promptText);
    await expect(textarea).toHaveValue(promptText);

    // Effacer le texte
    await textarea.fill('');
    await expect(textarea).toHaveValue('');
  });

  test('affiche les contrôles du modèle et de raisonnement', async ({ page }) => {
    // Le badge ou sélecteur de modèle est présent dans l'interface
    const composer = page.locator('footer, div').filter({ has: page.locator('textarea') }).first();
    await expect(composer).toBeVisible({ timeout: 10000 });

    // La zone d'actions du composer contient des boutons d'outils
    const buttons = composer.locator('button');
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThan(2);
  });

  test('supporte le thème sombre appliqué au document', async ({ page }) => {
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(true);
  });
});
