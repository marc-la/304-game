/**
 * Default name generator for lobby players.
 *
 * Generates 304-themed "Adjective Noun" pairs.
 * All combinations fit within MAX_NAME_LENGTH (12 chars).
 */

const ADJECTIVES = [
  "Bold", "Swift", "Sly", "Lucky", "Sharp",
  "Keen", "Wild", "Grand", "Brave", "Deft",
  "Quick", "Wily", "Calm", "Firm",
];

const NOUNS = [
  "Trump", "Dealer", "Jack", "Bidder", "Ace",
  "Cutter", "Bluff", "Player", "Trick", "Suit",
  "Hand", "Stone", "Queen", "Knight",
];

/**
 * Generate a random default name.
 * @returns {string} e.g. "Bold Trump"
 */
function generateDefaultName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

module.exports = { generateDefaultName };
