const { expect } = require("chai");
const {
  parseCard,
  cardPoints,
  handPoints,
  compareCards,
  cardSuit,
  minimalShuffle,
  fullShuffle,
  cutDeck,
  createPack,
  dealCards,
  getDealOrder,
  getCutterSeat,
  getNextSeat,
  getPrevSeat,
  getPartnerSeat,
  getTeamForSeat,
  resolveRound,
} = require("../src/deck");

describe("Deck", () => {
  describe("parseCard", () => {
    it("parses 2-char cards", () => {
      expect(parseCard("Jc")).to.deep.equal({ rank: "J", suit: "c" });
      expect(parseCard("9h")).to.deep.equal({ rank: "9", suit: "h" });
      expect(parseCard("As")).to.deep.equal({ rank: "A", suit: "s" });
    });

    it("parses 3-char 10 cards", () => {
      expect(parseCard("10d")).to.deep.equal({ rank: "10", suit: "d" });
      expect(parseCard("10c")).to.deep.equal({ rank: "10", suit: "c" });
    });
  });

  describe("cardPoints", () => {
    it("returns correct point values", () => {
      expect(cardPoints("Jc")).to.equal(30);
      expect(cardPoints("9h")).to.equal(20);
      expect(cardPoints("As")).to.equal(11);
      expect(cardPoints("10d")).to.equal(10);
      expect(cardPoints("Kc")).to.equal(3);
      expect(cardPoints("Qh")).to.equal(2);
      expect(cardPoints("8s")).to.equal(0);
      expect(cardPoints("7d")).to.equal(0);
    });
  });

  describe("handPoints", () => {
    it("sums card points", () => {
      expect(handPoints(["Jc", "9h"])).to.equal(50);
      expect(handPoints(["8s", "7d"])).to.equal(0);
      expect(handPoints(["Jc", "9c", "Ac", "10c"])).to.equal(71);
    });

    it("returns 0 for empty hand", () => {
      expect(handPoints([])).to.equal(0);
    });
  });

  describe("compareCards", () => {
    it("J beats 9", () => {
      expect(compareCards("Jc", "9c")).to.be.lessThan(0);
    });

    it("9 beats A", () => {
      expect(compareCards("9h", "Ah")).to.be.lessThan(0);
    });

    it("8 beats 7", () => {
      expect(compareCards("8s", "7s")).to.be.lessThan(0);
    });
  });

  describe("createPack", () => {
    it("creates 32 cards", () => {
      const pack = createPack();
      expect(pack).to.have.length(32);
    });

    it("has all 4 suits", () => {
      const pack = createPack();
      const suits = new Set(pack.map(cardSuit));
      expect(suits.size).to.equal(4);
    });

    it("totals 304 points", () => {
      const pack = createPack();
      expect(handPoints(pack)).to.equal(304);
    });
  });

  describe("shuffling", () => {
    it("minimal shuffle produces 32 cards", () => {
      const deck = minimalShuffle(createPack());
      expect(deck).to.have.length(32);
    });

    it("full shuffle produces 32 cards", () => {
      const deck = fullShuffle(createPack());
      expect(deck).to.have.length(32);
    });

    it("preserves all cards after shuffle", () => {
      const original = createPack();
      const shuffled = fullShuffle(original);
      expect(shuffled.sort()).to.deep.equal(original.sort());
    });
  });

  describe("cutDeck", () => {
    it("preserves all cards", () => {
      const deck = createPack();
      const cut = cutDeck(deck);
      expect(cut.sort()).to.deep.equal(deck.sort());
      expect(cut).to.have.length(32);
    });
  });

  describe("dealCards", () => {
    it("deals correct number of cards to each player", () => {
      const deck = [...createPack()];
      const order = ["west", "south", "east", "north"];
      const hands = dealCards(deck, order, 4);

      expect(hands.west).to.have.length(4);
      expect(hands.south).to.have.length(4);
      expect(hands.east).to.have.length(4);
      expect(hands.north).to.have.length(4);
      expect(deck).to.have.length(16); // 16 remaining
    });
  });

  describe("seat helpers", () => {
    it("getNextSeat is anticlockwise", () => {
      expect(getNextSeat("north")).to.equal("west");
      expect(getNextSeat("west")).to.equal("south");
      expect(getNextSeat("south")).to.equal("east");
      expect(getNextSeat("east")).to.equal("north");
    });

    it("getPrevSeat is clockwise", () => {
      expect(getPrevSeat("north")).to.equal("east");
      expect(getPrevSeat("west")).to.equal("north");
    });

    it("getPartnerSeat returns opposite", () => {
      expect(getPartnerSeat("north")).to.equal("south");
      expect(getPartnerSeat("south")).to.equal("north");
      expect(getPartnerSeat("east")).to.equal("west");
      expect(getPartnerSeat("west")).to.equal("east");
    });

    it("getTeamForSeat", () => {
      expect(getTeamForSeat("north")).to.equal("teamA");
      expect(getTeamForSeat("south")).to.equal("teamA");
      expect(getTeamForSeat("east")).to.equal("teamB");
      expect(getTeamForSeat("west")).to.equal("teamB");
    });

    it("getDealOrder starts right of dealer, anticlockwise", () => {
      const order = getDealOrder("north");
      expect(order).to.deep.equal(["west", "south", "east", "north"]);
    });

    it("getCutterSeat is left of dealer", () => {
      expect(getCutterSeat("north")).to.equal("east");
    });
  });

  describe("resolveRound", () => {
    it("highest card of led suit wins (no trump)", () => {
      const cards = [
        { seat: "north", card: "Jh", faceDown: false },
        { seat: "west", card: "9h", faceDown: false },
        { seat: "south", card: "Ah", faceDown: false },
        { seat: "east", card: "10h", faceDown: false },
      ];
      const result = resolveRound(cards, "c", true);
      expect(result.winner).to.equal("north"); // J beats all
      expect(result.pointsWon).to.equal(71); // 30+20+11+10
    });

    it("trump card wins over non-trump", () => {
      const cards = [
        { seat: "north", card: "Jh", faceDown: false },
        { seat: "west", card: "7c", faceDown: true },  // trump cut
        { seat: "south", card: "Ah", faceDown: false },
        { seat: "east", card: "10h", faceDown: false },
      ];
      const result = resolveRound(cards, "c", false);
      expect(result.trumpFound).to.be.true;
      expect(result.winner).to.equal("west"); // 7c is trump
    });

    it("highest trump wins when multiple trumps", () => {
      const cards = [
        { seat: "north", card: "Jh", faceDown: false },
        { seat: "west", card: "7c", faceDown: true },
        { seat: "south", card: "9c", faceDown: true },
        { seat: "east", card: "10h", faceDown: false },
      ];
      const result = resolveRound(cards, "c", false);
      expect(result.winner).to.equal("south"); // 9c > 7c
    });

    it("missed cut has no power", () => {
      const cards = [
        { seat: "north", card: "Jh", faceDown: false },
        { seat: "west", card: "7d", faceDown: true },  // wrong suit
        { seat: "south", card: "Ah", faceDown: false },
        { seat: "east", card: "10h", faceDown: false },
      ];
      const result = resolveRound(cards, "c", false);
      expect(result.trumpFound).to.be.false;
      expect(result.winner).to.equal("north"); // J of led suit
    });
  });
});
