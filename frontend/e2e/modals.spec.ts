import { test, expect } from '@playwright/test';
import { setupAuthSession, TEST_API_KEY } from './helpers';

test.describe('Modals & Paramètres', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthSession(page, TEST_API_KEY);
    await page.goto('/');
  });

  test('ouvre et ferme le modal de Configuration Antigravity', async ({ page }) => {
    // Cliquer sur le bouton Paramètres dans la barre latérale
    const settingsBtn = page.locator('aside button').filter({ hasText: /Paramètres|Settings/i }).first();
    await expect(settingsBtn).toBeVisible({ timeout: 10000 });
    await settingsBtn.click();

    // Vérifier l'ouverture du modal de configuration
    const modalHeader = page.locator('h2').filter({ hasText: /(Configuration|Antigravity)/i }).first();
    await expect(modalHeader).toBeVisible({ timeout: 10000 });

    // Vérifier la présence d'onglets de configuration
    const tabs = page.locator('button').filter({ hasText: /Session|Mod|Règle|Rule|Explor|File|Mém|Memory|Appar|Appear/i });
    expect(await tabs.count()).toBeGreaterThan(1);

    // Fermer le modal en cliquant sur le bouton de fermeture (croix)
    const closeBtn = page.locator('div.fixed').locator('button').filter({ has: page.locator('svg.lucide-x') }).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await expect(modalHeader).not.toBeVisible({ timeout: 5000 });
    }
  });

  test('ouvre le modal du sélecteur d\'espace de travail / projets', async ({ page }) => {
    // Bouton de sélection de workspace dans la sidebar
    const wsBtn = page.locator('aside button').filter({ hasText: /Workspace|Espace|Projet/i }).first();
    if (await wsBtn.isVisible()) {
      await wsBtn.click();
      // Un dialogue ou modal s'affiche
      const modal = page.locator('.fixed.inset-0').first();
      await expect(modal).toBeVisible({ timeout: 5000 });
      // Fermeture par touche Escape
      await page.keyboard.press('Escape');
    }
  });
});
