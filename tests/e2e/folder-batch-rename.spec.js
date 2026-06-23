const { test, expect } = require('./fixtures');

let seq = 0;
const uid = () => `${Date.now()}-${seq++}`;

async function selectTwoFolders(window, rowA, rowB) {
  await rowA.click();
  await rowB.click({ modifiers: ['Meta'] });
  await window.waitForTimeout(50);
}

async function folderTitles(window) {
  return window.evaluate(async () => {
    const items = await window.electronAPI.getListItems(0);
    return items.filter((i) => i.list_id !== null).map((i) => i.list_title);
  });
}

test.describe('Folder: batch rename', () => {
  test('renames selected folders with an exact-match find/replace', async ({ window }) => {
    const id = uid();
    await window.evaluate(async (s) => {
      await window.electronAPI.addFolder({ parentListId: 0, position: 0, title: `OldA-${s}` });
      await window.electronAPI.addFolder({ parentListId: 0, position: 1, title: `OldB-${s}` });
    }, id);

    await window.locator('.playlist-item').first().click();
    await window.waitForTimeout(200);

    const rowA = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: `OldA-${id}` });
    const rowB = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: `OldB-${id}` });
    await expect(rowA).toBeVisible({ timeout: 2000 });
    await selectTwoFolders(window, rowA, rowB);

    await rowB.click({ button: 'right' });
    await window.waitForTimeout(50);
    const batchItem = window.locator('.context-menu-item').filter({ hasText: 'Rename 2 folders' });
    await expect(batchItem).toBeVisible();
    await batchItem.click();

    await expect(window.locator('.qa-batch-pattern')).toBeVisible({ timeout: 1000 });
    await window.locator('.qa-batch-pattern').fill('Old');
    await window.locator('.qa-batch-replace').fill('New');
    await window.locator('.qa-batch-apply').click();
    await window.waitForTimeout(200);

    const titles = await folderTitles(window);
    expect(titles).toContain(`NewA-${id}`);
    expect(titles).toContain(`NewB-${id}`);

    // Cleanup
    for (const name of [`NewA-${id}`, `NewB-${id}`]) {
      const row = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: name });
      await row.click();
      await window.keyboard.press('Backspace');
      await window.waitForTimeout(100);
      await window.click('#modalYesBtn');
      await window.waitForTimeout(100);
    }
  });

  test('renames selected folders with a regex find/replace', async ({ window }) => {
    const id = uid();
    await window.evaluate(async (s) => {
      await window.electronAPI.addFolder({ parentListId: 0, position: 0, title: `Track01-${s}` });
      await window.electronAPI.addFolder({ parentListId: 0, position: 1, title: `Track02-${s}` });
    }, id);

    await window.locator('.playlist-item').first().click();
    await window.waitForTimeout(200);

    const rowA = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: `Track01-${id}` });
    const rowB = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: `Track02-${id}` });
    await expect(rowA).toBeVisible({ timeout: 2000 });
    await selectTwoFolders(window, rowA, rowB);

    await rowB.click({ button: 'right' });
    await window.waitForTimeout(50);
    await window.locator('.context-menu-item').filter({ hasText: 'Rename 2 folders' }).click();

    await expect(window.locator('.qa-batch-pattern')).toBeVisible({ timeout: 1000 });
    await window.locator('.qa-batch-mode').selectOption('regex');
    await window.locator('.qa-batch-pattern').fill('Track(\\d+)');
    await window.locator('.qa-batch-replace').fill('Song $1');
    await window.locator('.qa-batch-apply').click();
    await window.waitForTimeout(200);

    const titles = await folderTitles(window);
    expect(titles).toContain(`Song 01-${id}`);
    expect(titles).toContain(`Song 02-${id}`);

    // Cleanup
    for (const name of [`Song 01-${id}`, `Song 02-${id}`]) {
      const row = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: name });
      await row.click();
      await window.keyboard.press('Backspace');
      await window.waitForTimeout(100);
      await window.click('#modalYesBtn');
      await window.waitForTimeout(100);
    }
  });
});
