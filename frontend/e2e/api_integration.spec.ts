import { test, expect } from '@playwright/test';
import { TEST_API_KEY } from './helpers';

test.describe('API Integration E2E', () => {
  test('vérifie la route de santé publique /api/health', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('antigravity-webui');
  });

  test('vérifie le statut d\'authentification sans token', async ({ request }) => {
    const res = await request.get('/api/auth/status');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.enabled).toBe(true);
    expect(data.authenticated).toBe(false);
  });

  test('vérifie le statut d\'authentification avec une clé API valide', async ({ request }) => {
    const res = await request.get('/api/auth/status', {
      headers: {
        'X-API-Key': TEST_API_KEY,
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.enabled).toBe(true);
    expect(data.authenticated).toBe(true);
  });

  test('refuse les requêtes non authentifiées sur les routes protégées', async ({ request }) => {
    const res = await request.get('/api/workspaces');
    expect(res.status()).toBe(401);
  });

  test('autorise l\'accès aux espaces de travail avec la clé d\'API', async ({ request }) => {
    const res = await request.get('/api/workspaces', {
      headers: {
        'X-API-Key': TEST_API_KEY,
      },
    });
    expect(res.ok()).toBeTruthy();
    const workspaces = await res.json();
    expect(Array.isArray(workspaces)).toBe(true);
    expect(workspaces.length).toBeGreaterThan(0);
  });
});
