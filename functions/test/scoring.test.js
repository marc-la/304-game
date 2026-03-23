const { expect } = require("chai");
const { calculateResult } = require("../src/scoring");
const { PHASE } = require("../src/constants");

describe("Scoring", () => {
  function makeGame({ bid, isPCC, trumperSeat, teamAPoints, teamBPoints, capsCall, capsObligations }) {
    return {
      phase: PHASE.COMPLETE,
      trump: { trumperSeat: trumperSeat || "north" },
      bidding: {
        highestBid: bid || 160,
        isPCC: isPCC || false,
      },
      play: {
        pointsWon: {
          teamA: teamAPoints != null ? teamAPoints : 200,
          teamB: teamBPoints != null ? teamBPoints : 104,
        },
        capsCall: capsCall || null,
        capsObligations: capsObligations || {},
        completedRounds: [],
      },
      result: null,
    };
  }

  it("bid met — betting team gives stone", () => {
    const game = makeGame({ bid: 160, trumperSeat: "north", teamAPoints: 200, teamBPoints: 104 });
    const result = calculateResult(game);
    expect(result.reason).to.equal("bid_met");
    expect(result.stoneExchanged).to.equal(1);
    expect(result.stoneDirection).to.equal("give");
    expect(result.winnerTeam).to.equal("teamA");
  });

  it("bid failed — betting team receives stone", () => {
    const game = makeGame({ bid: 160, trumperSeat: "north", teamAPoints: 140, teamBPoints: 164 });
    const result = calculateResult(game);
    expect(result.reason).to.equal("bid_failed");
    expect(result.stoneExchanged).to.equal(2);
    expect(result.stoneDirection).to.equal("receive");
    expect(result.winnerTeam).to.equal("teamB");
  });

  it("bid of 200 — correct stone amounts", () => {
    const game = makeGame({ bid: 200, trumperSeat: "north", teamAPoints: 210, teamBPoints: 94 });
    const result = calculateResult(game);
    expect(result.reason).to.equal("bid_met");
    expect(result.stoneExchanged).to.equal(2);
  });

  it("bid of 200 failed", () => {
    const game = makeGame({ bid: 200, trumperSeat: "north", teamAPoints: 190, teamBPoints: 114 });
    const result = calculateResult(game);
    expect(result.reason).to.equal("bid_failed");
    expect(result.stoneExchanged).to.equal(3);
  });

  it("bid of 250 — correct stone amounts", () => {
    const game = makeGame({ bid: 250, trumperSeat: "north", teamAPoints: 260, teamBPoints: 44 });
    const result = calculateResult(game);
    expect(result.stoneExchanged).to.equal(3);
    expect(result.stoneDirection).to.equal("give");
  });

  it("bid of 250 failed", () => {
    const game = makeGame({ bid: 250, trumperSeat: "north", teamAPoints: 240, teamBPoints: 64 });
    const result = calculateResult(game);
    expect(result.stoneExchanged).to.equal(4);
    expect(result.stoneDirection).to.equal("receive");
  });

  it("PCC won", () => {
    const game = makeGame({ isPCC: true, trumperSeat: "north" });
    game.play.completedRounds = Array(8).fill(null).map((_, i) => ({
      roundNumber: i + 1,
      winner: "north",
    }));
    const result = calculateResult(game);
    expect(result.reason).to.equal("pcc_won");
    expect(result.stoneExchanged).to.equal(5);
    expect(result.stoneDirection).to.equal("give");
  });

  it("PCC lost", () => {
    const game = makeGame({ isPCC: true, trumperSeat: "north" });
    game.play.completedRounds = Array(8).fill(null).map((_, i) => ({
      roundNumber: i + 1,
      winner: i === 3 ? "east" : "north", // lost round 4
    }));
    const result = calculateResult(game);
    expect(result.reason).to.equal("pcc_lost");
    expect(result.stoneExchanged).to.equal(5);
    expect(result.stoneDirection).to.equal("receive");
  });

  it("exact bid threshold is a win", () => {
    const game = makeGame({ bid: 160, trumperSeat: "north", teamAPoints: 160, teamBPoints: 144 });
    const result = calculateResult(game);
    expect(result.reason).to.equal("bid_met");
  });

  it("one point under bid is a loss", () => {
    const game = makeGame({ bid: 160, trumperSeat: "north", teamAPoints: 159, teamBPoints: 145 });
    const result = calculateResult(game);
    expect(result.reason).to.equal("bid_failed");
  });

  it("Honest (220) bid met", () => {
    const game = makeGame({ bid: 220, trumperSeat: "north", teamAPoints: 230, teamBPoints: 74 });
    const result = calculateResult(game);
    expect(result.stoneExchanged).to.equal(2);
    expect(result.reason).to.equal("bid_met");
  });
});
