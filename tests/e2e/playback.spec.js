const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');

test.describe('Playback', () => {
  test('should start playback when double-clicking a song', async ({ window }) => {
    const testFilePath = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

    const playbackErrors = [];
    const errorHandler = msg => {
      if (msg.type() === 'error') {
        playbackErrors.push(msg.text());
      }
    };
    window.on('console', errorHandler);

    const importResult = await window.evaluate(async (filePath) => {
      try {
        const result = await window.electronAPI.importFiles({
          filePaths: [filePath],
          parentListId: 0,
          position: 0
        });
        return { success: true, result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }, testFilePath);

    expect(importResult.success).toBe(true);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(200);

    const songItem = await window.locator('.tree-item-content[data-is-folder="false"]').first();
    await expect(songItem).toBeVisible({ timeout: 2000 });

    await songItem.dblclick();
    await window.waitForTimeout(300);

    const playPauseBtn = await window.locator('#playPauseBtn');
    await expect(playPauseBtn).toHaveClass(/playing/);

    const relevantErrors = playbackErrors.filter(err =>
      !err.includes('[vite]') &&
      !err.includes('WebSocket')
    );
    expect(relevantErrors).toHaveLength(0);

    const songTitleElement = await window.locator('.player-info .song-title');
    await expect(songTitleElement).toBeVisible();
    const songTitle = await songTitleElement.textContent();
    expect(songTitle).toContain('Jump Into My Mouth');

    await playPauseBtn.click();
    await window.waitForTimeout(50);

    window.off('console', errorHandler);
  });

  test('should play song when Enter key is pressed', async ({ window }) => {
    const playbackErrors = [];
    const errorHandler = msg => {
      if (msg.type() === 'error') {
        playbackErrors.push(msg.text());
      }
    };
    window.on('console', errorHandler);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const songItem = await window.locator('.tree-item-content[data-is-folder="false"]').first();
    await expect(songItem).toBeVisible({ timeout: 2000 });
    await songItem.click();

    await window.keyboard.press('Enter');
    await window.waitForTimeout(300);

    const playPauseBtn = await window.locator('#playPauseBtn');
    await expect(playPauseBtn).toHaveClass(/playing/);

    const relevantErrors = playbackErrors.filter(err =>
      !err.includes('[vite]') &&
      !err.includes('WebSocket')
    );
    expect(relevantErrors).toHaveLength(0);

    await playPauseBtn.click();
    await window.waitForTimeout(50);

    window.off('console', errorHandler);
  });

  test('should seek without error when clicking seek bar during playback', async ({ window }) => {
    const seekErrors = [];
    const errorHandler = msg => {
      if (msg.type() === 'error') {
        seekErrors.push(msg.text());
      }
    };
    window.on('console', errorHandler);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const songItem = await window.locator('.tree-item-content[data-is-folder="false"]').first();
    await expect(songItem).toBeVisible({ timeout: 2000 });

    await songItem.dblclick();
    await window.waitForTimeout(500);

    const playPauseBtn = await window.locator('#playPauseBtn');
    await expect(playPauseBtn).toHaveClass(/playing/);

    const seekBar = await window.locator('#seekBar');
    await expect(seekBar).toBeVisible();

    const seekBox = await seekBar.boundingBox();
    if (seekBox) {
      await window.mouse.click(seekBox.x + seekBox.width * 0.5, seekBox.y + seekBox.height / 2);
      await window.waitForTimeout(100);
    }

    const relevantErrors = seekErrors.filter(err =>
      !err.includes('[vite]') &&
      !err.includes('WebSocket')
    );
    expect(relevantErrors).toHaveLength(0);

    const totalTime = await window.locator('#totalTime');
    const totalTimeText = await totalTime.textContent();
    expect(totalTimeText).not.toContain('Infinity');
    expect(totalTimeText).not.toContain('NaN');

    await playPauseBtn.click();
    await window.waitForTimeout(50);

    window.off('console', errorHandler);
  });
});
