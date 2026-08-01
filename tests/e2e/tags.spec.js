const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');

// Song rows at the library root (excludes folders).
const SONG_ROW = '.tree-item-content[data-is-folder="false"]';

async function gotoLibrary(window) {
  await window.keyboard.press('Escape');
  await window.locator('.playlist-item').first().click();
  await window.waitForTimeout(150);
}

// Create-and-apply a brand-new tag to the current selection via the editor's
// inline "Create" option.
async function createTag(window, name) {
  const input = window.locator('.qa-tag-input');
  await input.click();
  await input.fill(name);
  await window.waitForTimeout(120);
  await window.locator('.qa-tag-create').click();
  await window.waitForTimeout(200);
}

test.describe('Tags', () => {
  test.beforeAll(async ({ window }) => {
    const files = [
      path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3'),
      path.join(testAudioDir, 'test-tone.m4a'),
    ];
    await window.evaluate(async (fps) => {
      for (const fp of fps) {
        try {
          await window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 });
        } catch (e) { /* may already exist */ }
      }
    }, files);
    await gotoLibrary(window);
  });

  test('create a tag from the edit panel: chip appears in sidebar and pill in column', async ({ window }) => {
    await gotoLibrary(window);
    await window.locator(SONG_ROW).first().click();
    await expect(window.locator('.qa-song-edit-panel')).toBeVisible();

    await createTag(window, 'chill');

    // Sidebar chip
    const chip = window.locator('.qa-tags-section .tag-pill', { hasText: 'chill' });
    await expect(chip).toBeVisible();

    // Column pill on the selected song
    const pill = window.locator(`${SONG_ROW}.selected .col-tags .tag-pill`, { hasText: 'chill' });
    await expect(pill).toBeVisible();
  });

  test('solid border when applied to all selected songs, dashed when only some', async ({ window }) => {
    await gotoLibrary(window);
    const rows = window.locator(SONG_ROW);

    // Apply "loud" to just the first song
    await rows.nth(0).click();
    await createTag(window, 'loud');

    // Select both songs -> "loud" (on 1 of 2) should be dashed
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Meta'] });
    await window.waitForTimeout(150);

    const loudPill = window.locator('.qa-tag-editor-pills .tag-pill', { hasText: 'loud' });
    await expect(loudPill).toHaveClass(/tag-pill-dashed/);

    // Apply a new tag "both" to both songs -> solid (not dashed)
    await createTag(window, 'both');
    const bothPill = window.locator('.qa-tag-editor-pills .tag-pill', { hasText: 'both' });
    await expect(bothPill).toBeVisible();
    await expect(bothPill).not.toHaveClass(/tag-pill-dashed/);
  });

  test('click a pill then Backspace removes it from all selected songs (and does not delete the songs)', async ({ window }) => {
    await gotoLibrary(window);
    const rows = window.locator(SONG_ROW);
    const songCountBefore = await rows.count();
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Meta'] });
    await window.waitForTimeout(150);

    const bothPill = window.locator('.qa-tag-editor-pills .tag-pill', { hasText: 'both' });
    await expect(bothPill).toBeVisible();
    await bothPill.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(200);

    await expect(window.locator('.qa-tag-editor-pills .tag-pill', { hasText: 'both' })).toHaveCount(0);
    // The tag definition still exists in the sidebar (removal != delete)...
    await expect(window.locator('.qa-tags-section .tag-pill', { hasText: 'both' })).toBeVisible();
    // ...and Backspace must NOT have fallen through to deleting the selected songs.
    await expect(window.locator(SONG_ROW)).toHaveCount(songCountBefore);
  });

  test('arrow keys during pill selection navigate pills without expanding/collapsing the selected folder', async ({ window }) => {
    await gotoLibrary(window);
    // Build a collapsed folder that contains a song, so the edit panel resolves it.
    const folderId = await window.evaluate(async () => {
      const items = await window.electronAPI.getAllListItems();
      const song = items.find(i => i.song_id !== null);
      const fid = await window.electronAPI.addFolder({ parentListId: 0, position: 0, title: 'ArrowFolder' });
      await window.electronAPI.addSongToList({ songId: song.song_id, parentListId: fid, position: 0 });
      return fid;
    });
    await gotoLibrary(window);

    const folderRow = window.locator(`.tree-item-content[data-folder-id="${folderId}"]`);
    await folderRow.click();
    await expect(window.locator('.qa-song-edit-panel')).toBeVisible();
    await createTag(window, 'arrowtag');

    const chevron = folderRow.locator('.tree-item-icon.chevron');
    const expandedBefore = await chevron.evaluate(el => el.classList.contains('expanded'));

    const pill = window.locator('.qa-tag-editor-pills .tag-pill', { hasText: 'arrowtag' });
    await pill.click();
    await window.keyboard.press('ArrowRight');
    await window.keyboard.press('ArrowLeft');
    await window.waitForTimeout(150);

    const expandedAfter = await chevron.evaluate(el => el.classList.contains('expanded'));
    expect(expandedAfter).toBe(expandedBefore); // folder state unchanged
  });

  test('left-clicking a sidebar tag chip searches for that tag and marks it active', async ({ window }) => {
    await gotoLibrary(window);
    const chip = window.locator('.qa-tags-section .tag-pill', { hasText: 'chill' });
    await chip.click();
    await window.waitForTimeout(200);

    await expect(window.locator('#currentListTitle')).toHaveText('Search Results in Main Library');
    await expect(window.locator('.search-input')).toHaveValue('tag=chill');
    await expect(window.locator('.qa-search-song').first()).toBeVisible();

    // The clicked chip shows the active-filter glow while it is the sole filter...
    await expect(chip).toHaveClass(/tag-pill-active/);

    // ...and clearing the search removes the active state.
    await window.locator('.search-clear-btn').click();
    await window.waitForTimeout(100);
    await expect(chip).not.toHaveClass(/tag-pill-active/);
  });

  test('Change Color via context menu updates the pill border color', async ({ window }) => {
    await gotoLibrary(window);
    await window.locator(SONG_ROW).first().click();
    await createTag(window, 'colorme');

    const chip = window.locator('.qa-tags-section .tag-pill', { hasText: 'colorme' });
    await chip.dispatchEvent('contextmenu');
    await expect(window.locator('.tag-context-menu')).toBeVisible();
    await window.locator('.qa-tag-change-color').click();
    await expect(window.locator('.tag-color-popover')).toBeVisible();

    // Pick a known swatch and assert the chip adopts that color
    const swatch = window.locator('.qa-tag-color-swatch').first();
    const swatchColor = await swatch.evaluate(el => el.style.backgroundColor);
    await swatch.click();
    await window.waitForTimeout(200);

    const chipColor = await chip.evaluate(el => el.style.getPropertyValue('--tag-color'));
    // chipColor is the hex we stored; compare via a normalizing round-trip
    const normalized = await window.evaluate((hex) => {
      const d = document.createElement('div');
      d.style.color = hex;
      document.body.appendChild(d);
      const rgb = getComputedStyle(d).color;
      d.remove();
      return rgb;
    }, chipColor);
    expect(normalized).toBe(swatchColor);
  });

  test('the tag rename dialog is titled "Rename Tag"', async ({ window }) => {
    await gotoLibrary(window);
    await window.locator(SONG_ROW).first().click();
    await createTag(window, 'titledtag');

    const chip = window.locator('.qa-tags-section .tag-pill', { hasText: 'titledtag' });
    await chip.dispatchEvent('contextmenu');
    await window.locator('.qa-tag-rename').click();

    await expect(window.locator('#renameModalTitle')).toHaveText('Rename Tag');
    await window.locator('#renameCancelBtn').click();
  });

  test('the color popover is titled "Pick tag color" and stays inside the viewport near an edge', async ({ window }) => {
    await gotoLibrary(window);
    await window.locator(SONG_ROW).first().click();
    await createTag(window, 'edgetag');

    await expect(window.locator('.qa-tags-section .tag-pill', { hasText: 'edgetag' })).toBeVisible();
    const viewport = await window.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    // Right-click in the bottom-right corner: the popover would otherwise open
    // below the fold with nothing to scroll it back into view.
    await window.evaluate(({ x, y }) => {
      const el = [...document.querySelectorAll('.qa-tags-section .tag-pill')]
        .find((p) => p.textContent === 'edgetag');
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: viewport.w - 20, y: viewport.h - 20 });
    // The menu itself opens at the cursor and is mostly off-screen here, so the
    // item is clicked by dispatch rather than by hit-testing a real mouse click.
    await window.locator('.qa-tag-change-color').dispatchEvent('click');

    const popover = window.locator('.tag-color-popover');
    await expect(popover).toBeVisible();
    await expect(popover.locator('.qa-tag-color-title')).toHaveText('Pick tag color');

    const box = await popover.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.w);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.h);

    await window.keyboard.press('Escape');
  });

  test('Rename via context menu updates the chip and column pills', async ({ window }) => {
    await gotoLibrary(window);
    await window.locator(SONG_ROW).first().click();
    await createTag(window, 'renameme');

    const chip = window.locator('.qa-tags-section .tag-pill', { hasText: 'renameme' });
    await chip.dispatchEvent('contextmenu');
    await expect(window.locator('.tag-context-menu')).toBeVisible();
    await window.locator('.qa-tag-rename').click();

    const input = window.locator('#renameInput');
    await expect(input).toBeVisible();
    await input.fill('renamed-tag');
    await window.locator('#renameOkBtn').click();
    await window.waitForTimeout(200);

    await expect(window.locator('.qa-tags-section .tag-pill', { hasText: 'renamed-tag' })).toBeVisible();
    await expect(window.locator('.qa-tags-section .tag-pill', { hasText: /^renameme$/ })).toHaveCount(0);
    // The rename propagates to the song's column pill
    await expect(window.locator('.col-tags .tag-pill', { hasText: 'renamed-tag' }).first()).toBeVisible();
  });

  test('Delete Tag via context menu removes the chip and its pills', async ({ window }) => {
    await gotoLibrary(window);
    await window.locator(SONG_ROW).first().click();
    await createTag(window, 'deleteme');
    await expect(window.locator('.col-tags .tag-pill', { hasText: 'deleteme' }).first()).toBeVisible();

    const chip = window.locator('.qa-tags-section .tag-pill', { hasText: 'deleteme' });
    await chip.dispatchEvent('contextmenu');
    await expect(window.locator('.tag-context-menu')).toBeVisible();
    await window.locator('.qa-tag-delete').click();
    await window.locator('#modalYesBtn').click();
    await window.waitForTimeout(200);

    await expect(window.locator('.qa-tags-section .tag-pill', { hasText: 'deleteme' })).toHaveCount(0);
    await expect(window.locator('.col-tags .tag-pill', { hasText: 'deleteme' })).toHaveCount(0);
  });

  test('drag-reordering tag chips persists the new order', async ({ window }) => {
    await gotoLibrary(window);
    // Create two fresh, order-deterministic tags on the first song
    await window.locator(SONG_ROW).first().click();
    await createTag(window, 'zeta-order');
    await createTag(window, 'alpha-order');

    const names = () => window.evaluate(() =>
      Array.from(document.querySelectorAll('.qa-tags-section .tag-pill'))
        .map(el => el.dataset.tagName));

    const before = await names();
    const zi = before.indexOf('zeta-order');
    const ai = before.indexOf('alpha-order');
    expect(zi).toBeGreaterThanOrEqual(0);
    expect(ai).toBeGreaterThan(zi); // alpha was created after zeta -> later position

    // Drag alpha-order onto zeta-order (drop-before), via native DnD events
    await window.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('.qa-tags-section .tag-pill'));
      const src = chips.find(c => c.dataset.tagName === 'alpha-order').parentElement;
      const tgt = chips.find(c => c.dataset.tagName === 'zeta-order').parentElement;
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    });
    await window.waitForTimeout(250);

    const after = await names();
    expect(after.indexOf('alpha-order')).toBeLessThan(after.indexOf('zeta-order'));
  });

  test('the Tags column stretches to fill the remaining width (last column)', async ({ window }) => {
    await gotoLibrary(window);
    const row = window.locator(SONG_ROW).first();
    await expect(row).toBeVisible();
    const lastTrackPx = await row.evaluate(el => {
      const tracks = getComputedStyle(el).gridTemplateColumns.split(' ');
      return parseFloat(tracks[tracks.length - 1]);
    });
    // Old behavior was a fixed 100px; it should now stretch well beyond that.
    expect(lastTrackPx).toBeGreaterThan(130);
  });

  test('the Tags cell reaches the row edge (no right-padding gap)', async ({ window }) => {
    await gotoLibrary(window);
    const row = window.locator(SONG_ROW).first();
    await expect(row).toBeVisible();
    const gap = await row.evaluate(el => {
      const cell = el.querySelector('.col-tags');
      return el.getBoundingClientRect().right - cell.getBoundingClientRect().right;
    });
    // The tags cell should extend all the way to the row's right edge.
    expect(gap).toBeLessThanOrEqual(1);
  });

  test('Advanced Search offers a Tag condition with a dropdown of defined tags', async ({ window }) => {
    await gotoLibrary(window);
    await window.locator('.search-advanced-btn').click();
    await expect(window.locator('.advanced-search-dialog')).toBeVisible();

    await window.locator('.advsearch-field-select').first().selectOption('tag');
    const tagSelect = window.locator('.advsearch-tag-select').first();
    await expect(tagSelect).toBeVisible();
    const optionCount = await tagSelect.locator('option').count();
    expect(optionCount).toBeGreaterThan(0);

    // The is/is-not toggle is present for tag conditions
    await expect(window.locator('.advsearch-op-select').first()).toBeVisible();

    await window.locator('.modal-btn-secondary').first().click();
    await window.waitForTimeout(100);
  });
});
