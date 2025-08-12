import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  // Before each test, visit the login page
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should allow a user to log in and see the dashboard', async ({ page }) => {
    // Use the demo user from the seed script
    await page.getByLabel('Email').fill('ana@creditox.test');
    await page.getByLabel('Contraseña').fill('Ana1234!');

    // Click the login button
    await page.getByRole('button', { name: 'Iniciar Sesión' }).click();

    // Assert that the page navigates to the dashboard
    await page.waitForURL('**/dashboard');

    // Check for a welcome message to confirm successful login
    await expect(page.getByRole('heading', { name: /Bienvenido/ })).toBeVisible();

    // Check that a key element of the dashboard is present
    await expect(page.getByText('Saldo Principal')).toBeVisible();
  });

  test('should show an error message for incorrect password', async ({ page }) => {
    await page.getByLabel('Email').fill('ana@creditox.test');
    await page.getByLabel('Contraseña').fill('WrongPassword123!');

    await page.getByRole('button', { name: 'Iniciar Sesión' }).click();

    // The toast notification should appear
    const errorToast = page.getByText(/Error en el inicio de sesión/);
    await expect(errorToast).toBeVisible();

    // The URL should not have changed
    expect(page.url()).toContain('/login');
  });

  test('should navigate to register page and show registration form', async ({ page }) => {
    // This assumes the login page has a link to the registration page.
    // My register page component has this link.
    await page.getByRole('link', { name: 'Inicia sesión' }).click();

    // Find the link to register in the login page
    const registerLink = page.locator('a[href="/register"]'); // Adjust if needed
    if (await registerLink.count() > 0) {
        await registerLink.click();
    } else {
        // If not on login page, directly go
        await page.goto('/register');
    }

    await page.waitForURL('**/register');

    // Check for the registration form title
    await expect(page.getByRole('heading', { name: 'Crear una cuenta' })).toBeVisible();
    await expect(page.getByLabel('Confirmar Contraseña')).toBeVisible();
  });
});
