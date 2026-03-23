const { expect } = require("chai");
const { checkCapsObligation, getPermutations } = require("../src/caps");

describe("Caps", () => {
  describe("getPermutations", () => {
    it("returns single-element array for single item", () => {
      expect(getPermutations(["a"])).to.deep.equal([["a"]]);
    });

    it("returns 2 permutations for 2 items", () => {
      const perms = getPermutations(["a", "b"]);
      expect(perms).to.have.length(2);
      expect(perms).to.deep.include(["a", "b"]);
      expect(perms).to.deep.include(["b", "a"]);
    });

    it("returns 6 permutations for 3 items", () => {
      const perms = getPermutations(["a", "b", "c"]);
      expect(perms).to.have.length(6);
    });

    it("returns 24 permutations for 4 items", () => {
      const perms = getPermutations(["a", "b", "c", "d"]);
      expect(perms).to.have.length(24);
    });
  });

  describe("checkCapsObligation", () => {
    it("returns false if team has lost a round", () => {
      const game = {
        trump: { trumpSuit: "c", trumperSeat: "north", isRevealed: true, isOpen: false },
        hands: {
          north: ["Jc", "9c", "Ac", "Jh"],
          west: ["8h", "7h", "8d", "7d"],
          south: ["Qs", "8s", "7s", "Qd"],
          east: ["Kh", "Qh", "Kd", "Qd"],
        },
        play: {
          roundNumber: 5,
          priority: "north",
          currentRound: [],
          completedRounds: [
            { roundNumber: 1, winner: "north" },
            { roundNumber: 2, winner: "north" },
            { roundNumber: 3, winner: "east" },   // team A lost this round
            { roundNumber: 4, winner: "north" },
          ],
          pointsWon: { teamA: 100, teamB: 50 },
          capsObligations: {},
        },
        pccPartnerOut: null,
        bidding: { highestBid: 160, isPCC: false },
      };

      const result = checkCapsObligation(game, "north");
      expect(result).to.be.false;
    });

    it("detects caps when player holds all highest cards", () => {
      const game = {
        trump: { trumpSuit: "c", trumperSeat: "north", isRevealed: true, isOpen: true },
        hands: {
          north: ["Jc", "9c", "Ac", "Jh"],
          west: ["8h", "7h", "8d", "7d"],
          south: ["Qs", "8s", "7s", "Qd"],
          east: ["Kh", "Qh", "Kd", "Qd"],
        },
        play: {
          roundNumber: 5,
          priority: "north",
          currentRound: [],
          completedRounds: [
            { roundNumber: 1, winner: "north", cards: [
              { seat: "north", card: "10c", faceDown: false },
              { seat: "west", card: "8c", faceDown: false },
              { seat: "south", card: "7c", faceDown: false },
              { seat: "east", card: "9c", faceDown: false },
            ]},
            { roundNumber: 2, winner: "north", cards: [
              { seat: "north", card: "Jd", faceDown: false },
              { seat: "west", card: "Kd", faceDown: false },
              { seat: "south", card: "Ad", faceDown: false },
              { seat: "east", card: "10d", faceDown: false },
            ]},
            { roundNumber: 3, winner: "south", cards: [
              { seat: "south", card: "Js", faceDown: false },
              { seat: "east", card: "9s", faceDown: false },
              { seat: "north", card: "Ks", faceDown: false },
              { seat: "west", card: "9d", faceDown: false },
            ]},
            { roundNumber: 4, winner: "north", cards: [
              { seat: "north", card: "As", faceDown: false },
              { seat: "west", card: "10s", faceDown: false },
              { seat: "south", card: "9h", faceDown: false },
              { seat: "east", card: "Ah", faceDown: false },
            ]},
          ],
          pointsWon: { teamA: 200, teamB: 0 },
          capsObligations: {},
        },
        pccPartnerOut: null,
        bidding: { highestBid: 160, isPCC: false },
      };

      const result = checkCapsObligation(game, "north");
      expect(result).to.be.true;
    });
  });
});
