/**
 * Fisher-Yates shuffle algorithm
 * Creates a new shuffled array without modifying the original
 * @param {any[]} array
 * @returns {any[]} New shuffled array
 */
export function shuffleArray(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Create a shuffled array of indices
 * Useful for shuffle-without-replacement playback
 * @param {number} length
 * @returns {number[]} Shuffled indices array
 */
export function createShuffledIndices(length) {
  return shuffleArray([...Array(length).keys()]);
}

/**
 * Create a shuffled array with a specific item kept at the front
 * Useful for starting shuffle from current song
 * @param {number} length - Total length
 * @param {number} pinnedIndex - Index to keep at position 0
 * @returns {number[]} Shuffled indices with pinnedIndex first
 */
export function createShuffledIndicesWithPin(length, pinnedIndex) {
  const indices = [...Array(length).keys()];
  const otherIndices = indices.filter(i => i !== pinnedIndex);
  const shuffled = shuffleArray(otherIndices);
  return [pinnedIndex, ...shuffled];
}
