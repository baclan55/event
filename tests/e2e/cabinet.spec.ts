import { expect, test } from '@playwright/test';

const e2eHeaders = { 'x-e2e-secret': 'local-playwright-secret' };

test.beforeEach(async ({ page }) => {
  const response = await page.request.post('/api/e2e/session', { headers: e2eHeaders });
  expect(response.ok(), await response.text()).toBeTruthy();
});

test.afterEach(async ({ page }) => {
  await page.request.delete('/api/e2e/session', { headers: e2eHeaders });
});

test.afterAll(async ({ request }) => {
  await request.delete('/api/e2e/session?purge=1', { headers: e2eHeaders });
});

test('пользователь меняет собственный никнейм', async ({ page }) => {
  await page.goto('/app/profile');
  await page.getByTitle('Изменить никнейм').click();
  const dialog = page.getByRole('dialog', { name: 'Изменить никнейм' });
  await dialog.locator('input').fill('E2E Owner Updated');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Owner Updated' })).toBeVisible();
});

test('пользователь создаёт заявку на отпуск', async ({ page }) => {
  await page.goto('/app/vacations');
  await page.getByRole('button', { name: 'Новый отпуск' }).click();

  const days = page.locator('.vac-mini-day:not(.is-muted)');
  await days.nth(10).click();
  await days.nth(12).click();
  const dialog = page.getByRole('dialog', { name: 'Новый отпуск' });
  await dialog.locator('textarea').fill('E2E vacation');
  await dialog.getByRole('button', { name: 'Создать' }).click();

  await expect(page.getByText('E2E vacation')).toBeVisible();
  await expect(page.getByText('На рассмотрении').first()).toBeVisible();
});

test('администратор редактирует helper-раздел FAQ', async ({ page }) => {
  const current = await (await page.request.get('/api/content/faq')).json();
  const original = current.blocks?.helper?.bodyRaw ?? current.blocks?.general?.bodyRaw ?? '';
  const marker = `E2E FAQ ${Date.now()}`;

  try {
    await page.goto('/app/faq');
    await page.getByRole('button', { name: 'Редактировать' }).click();
    await page.locator('.mde-textarea').fill(marker);
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText(marker)).toBeVisible();
  } finally {
    await page.request.put('/api/content/faq', {
      data: { audience: 'helper', body: original },
    });
  }
});

test('руководитель выдаёт и удаляет выговор', async ({ page }) => {
  const marker = `E2E reprimand ${Date.now()}`;
  await page.goto('/app/reprimands');
  await page.getByRole('button', { name: 'Добавить выговор' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый выговор' });
  const optionValue = await dialog.locator('select option', { hasText: 'E2E Target' }).getAttribute('value');
  await dialog.locator('select[name="userId"]').selectOption(optionValue || '');
  await dialog.locator('textarea[name="reason"]').fill(marker);
  await dialog.getByRole('button', { name: 'Добавить' }).click();

  const entry = page.locator('.rp-entry').filter({ hasText: marker });
  await expect(entry).toBeVisible();
  await entry.locator('button').click();
  await page.getByRole('dialog', { name: 'Удаление' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(entry).toBeHidden();
});

test('владелец изменяет роли сотрудника', async ({ page }) => {
  await page.goto('/app/roster');
  const row = page.locator('.roster-row').filter({ hasText: 'E2E Target' });
  await row.getByTitle('Редактировать').click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Event Helper').uncheck();
  await dialog.getByLabel('Chief Event').check();
  await dialog.getByRole('button', { name: 'Сохранить' }).click();

  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.locator('.roster-row').filter({ hasText: 'E2E Target' })).toContainText('Chief Event');
});
