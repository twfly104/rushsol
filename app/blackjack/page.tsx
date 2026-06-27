"use client";

import { useEffect, useState } from "react";
import { generateServerSeed, hashSeed, blackjackShuffle } from "@/lib/provablyFair";
import { useMockBalance } from "@/components/MockBalanceProvider";
import { logRound } from "@/lib/roundLog";
import { audit } from "@/lib/clientAudit";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function cardName(idx: number) {
  const suit = SUITS[Math.floor(idx / 13)];
  const rank = RANKS[idx % 13];
  return { rank, suit, red: suit === "♥" || suit === "♦" };
}

function handValue(cards: number[]) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const rank = RANKS[c % 13];
    if (rank === "A") {
      aces += 1;
      total += 11;
    } else if (["J", "Q", "K"].includes(rank)) total += 10;
    else total += parseInt(rank, 10);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

type Phase = "bet" | "dealing" | "insurance" | "player" | "dealer" | "done";

interface RoundInfo {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  clientSeedHash: string;
  nonce: number;
}

// Blackjack payout structure:
//   Win (regular):  1:1
//   Win (blackjack): 3:2
//   Insurance:       2:1
//   Push:            1:1 (return bet)
//   Lose:            0
//
// The house has a structural edge of ~0.5% in standard 21 with the 3:2
// blackjack payout. We do not modify the deck order — what you see is
// what the seed-chain produced.
const BLACKJACK_PAYOUT = 1.5; // 3:2
const INSURANCE_PAYOUT = 2.0; // 2:1

export default function BlackjackPage() {
  const { balance, credit, debit } = useMockBalance();
  const [bet, setBet] = useState(0.1);
  const [deck, setDeck] = useState<number[]>([]);
  const [playerCards, setPlayerCards] = useState<number[]>([]);
  const [dealerCards, setDealerCards] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>("bet");
  const [outcome, setOutcome] = useState<"win" | "lose" | "push" | "bust" | "bj" | null>(null);
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<string>("");
  const [stats, setStats] = useState({ wins: 0, losses: 0, pushes: 0 });
  const [insuranceBet, setInsuranceBet] = useState(0);
  const [insuranceResolved, setInsuranceResolved] = useState<null | "won" | "lost">(null);

  // Sequential deal: card 0 (player), 1 (dealer), 2 (player), 3 (dealer).
  // Each card flips in with a delay so the user sees the deal rhythm.
  async function deal() {
    setError("");
    if (bet <= 0) return setError("Bet must be > 0");
    if (bet > balance) return setError("Insufficient mock balance");
    if (!debit(bet)) return setError("Insufficient mock balance");

    audit({
      action: "BET_PLACED",
      payload: { game: "blackjack", betAmount: bet },
    });

    const serverSeed = generateServerSeed();
    const serverSeedHash = await hashSeed(serverSeed);
    const clientSeed = crypto.randomUUID();
    const clientSeedHash = await hashSeed(clientSeed);
    const r = await blackjackShuffle(serverSeed, clientSeed, nonce);
    setRound({ serverSeed, serverSeedHash, clientSeed, clientSeedHash, nonce });
    setDeck(r.deck);
    setPlayerCards([]);
    setDealerCards([]);
    setOutcome(null);
    setInsuranceBet(0);
    setInsuranceResolved(null);
    setNonce((n) => n + 1);
    setPhase("dealing");

    // Deal one card at a time, ~500ms apart.
    const order: ("player" | "dealer")[] = ["player", "dealer", "player", "dealer"];
    for (let i = 0; i < order.length; i++) {
      await new Promise((res) => setTimeout(res, 550));
      if (order[i] === "player") {
        setPlayerCards((c) => [...c, r.deck[i]]);
      } else {
        setDealerCards((c) => [...c, r.deck[i]]);
      }
    }
    await new Promise((res) => setTimeout(res, 250));

    const finalPlayer = [r.deck[0], r.deck[2]];
    const finalDealer = [r.deck[1], r.deck[3]];
    const playerBJ = handValue(finalPlayer) === 21;
    const dealerBJ = handValue(finalDealer) === 21;
    const dealerUpcard = finalDealer[0];
    const dealerUpIsAce = SUITS[Math.floor(dealerUpcard / 13)] !== undefined && RANKS[dealerUpcard % 13] === "A";

    if (playerBJ && dealerBJ) {
      finish("push", playerBJ, dealerBJ);
    } else if (playerBJ) {
      finish("bj", true, false);
    } else if (dealerBJ) {
      // Dealer has blackjack — no insurance question (reveal hole card).
      finish("lose", false, true);
    } else if (dealerUpIsAce && balance >= bet / 2) {
      // Offer insurance
      setPhase("insurance");
    } else {
      setPhase("player");
    }
  }

  function takeInsurance() {
    const ins = bet / 2;
    if (balance < ins) {
      setError("Insufficient mock balance for insurance");
      return;
    }
    debit(ins);
    setInsuranceBet(ins);
    setPhase("player");
    // Insurance resolves when dealer's hole card is revealed (end of round).
  }

  function declineInsurance() {
    setPhase("player");
  }

  function hit() {
    if (phase !== "player") return;
    setPlayerCards((c) => {
      const next = [...c, deck[c.length + dCount()]];
      if (handValue(next) > 21) {
        // Reveal hole card, dealer doesn't draw
        finish("bust");
      }
      return next;
    });
  }

  // Helper: how many cards have been dealt in total (player + dealer).
  function dCount() {
    return playerCards.length + dealerCards.length;
  }

  function stand() {
    setPhase("dealer");
  }

  async function doubleDown() {
    if (balance < bet) {
      setError("Insufficient mock balance to double");
      return;
    }
    debit(bet);
    setBet((b) => b * 2);
    // Hit one card, then stand.
    hit();
    if (handValue(playerCards) <= 21) stand();
  }

  // Dealer play: stand on 17.
  useEffect(() => {
    if (phase !== "dealer") return;
    let localDealer = [...dealerCards];
    const interval = setInterval(() => {
      if (handValue(localDealer) < 17) {
        const next = deck[playerCards.length + localDealer.length];
        localDealer = [...localDealer, next];
        setDealerCards(localDealer);
      } else {
        clearInterval(interval);
        const pv = handValue(playerCards);
        const dv = handValue(localDealer);
        if (dv > 21 || pv > dv) finish("win");
        else if (pv === dv) finish("push");
        else finish("lose");
      }
    }, 700);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function finish(result: "win" | "lose" | "push" | "bust" | "bj", playerBJ = false, dealerBJ = false) {
    setOutcome(result);

    // Insurance resolution
    if (insuranceBet > 0) {
      if (dealerBJ) {
        credit(insuranceBet * (1 + INSURANCE_PAYOUT));
        setInsuranceResolved("won");
      } else {
        setInsuranceResolved("lost");
      }
    }

    // Main bet resolution
    let payout = 0;
    if (result === "win") {
      payout = bet * 2;
      credit(payout);
    } else if (result === "bj") {
      payout = bet * (1 + BLACKJACK_PAYOUT);
      credit(payout);
    } else if (result === "push") {
      payout = bet;
      credit(payout);
    }

    // One round log + audit per finished hand. The round entry is captured
    // here so it includes the final player/dealer cards (visible in `deck`
    // and resolved via the per-side card arrays at this point).
    const r = round;
    if (r) {
      logRound({
        game: "blackjack",
        outcome: result,
        deckHead: deck.slice(0, 8),
        serverSeed: r.serverSeed,
        serverSeedHash: r.serverSeedHash,
        clientSeed: r.clientSeed,
        clientSeedHash: r.clientSeedHash,
        nonce: r.nonce,
        betAmount: bet + insuranceBet,
        payout,
        resolvedAt: Date.now(),
      });
      audit({
        action: "BET_RESOLVED",
        payload: { game: "blackjack", nonce: r.nonce, outcome: result, payout },
      });
    }

    setStats((s) => ({
      wins: s.wins + (result === "win" || result === "bj" ? 1 : 0),
      losses: s.losses + (result === "lose" || result === "bust" ? 1 : 0),
      pushes: s.pushes + (result === "push" ? 1 : 0),
    }));
    setPhase("done");
  }

  function newRound() {
    setPlayerCards([]);
    setDealerCards([]);
    setDeck([]);
    setOutcome(null);
    setRound(null);
    setBet(0.1);
    setPhase("bet");
    setInsuranceBet(0);
    setInsuranceResolved(null);
  }

  const dealerValue = phase === "player" || phase === "dealing" || phase === "insurance"
    ? null
    : handValue(dealerCards);
  const dealerUpcard = dealerCards[0];
  const dealerHoleRevealed = phase !== "player" && phase !== "dealing" && phase !== "insurance";
  const playerValue = handValue(playerCards);

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Blackjack</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            The deck is shuffled from SHA-256 before each hand. Cards are
            dealt one at a time.
          </p>
        </div>
        <div
          className="rounded-lg p-3 grid grid-cols-3 gap-4 text-center text-xs"
          style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}
        >
          <Stat label="Won" value={stats.wins.toString()} color="var(--accent)" />
          <Stat label="Lost" value={stats.losses.toString()} color="var(--danger)" />
          <Stat label="Push" value={stats.pushes.toString()} color="var(--warning)" />
        </div>
      </header>

      {/* TABLE */}
      <div
        className="panel relative overflow-hidden p-6 sm:p-8"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--accent2) 15%, var(--surface)) 0%, var(--surface) 60%)",
          minHeight: 520,
        }}
      >
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative space-y-10">
          <DealerHand
            cards={dealerCards}
            holeRevealed={dealerHoleRevealed}
            value={dealerValue}
            insuranceWon={insuranceResolved === "won"}
            insuranceLost={insuranceResolved === "lost"}
          />
          {/* Action zone */}
          <div className="flex justify-center min-h-[90px] items-center">
            {phase === "bet" && (
              <div className="text-center" style={{ color: "var(--muted)" }}>
                <div className="text-sm">Place a bet and deal.</div>
              </div>
            )}
            {phase === "dealing" && (
              <div
                className="text-sm font-mono animate-pulse-slow"
                style={{ color: "var(--muted)" }}
              >
                Dealing…
              </div>
            )}
            {phase === "insurance" && dealerUpcard !== undefined && (
              <div className="text-center animate-slide-up max-w-md">
                <div className="font-display text-lg font-semibold mb-2" style={{ color: "var(--warning)" }}>
                  Dealer shows an Ace
                </div>
                <div className="text-sm mb-3" style={{ color: "var(--muted)" }}>
                  Insurance pays 2:1 if dealer has blackjack. Cost:{" "}
                  <span className="font-mono font-semibold" style={{ color: "var(--text)" }}>
                    {(bet / 2).toFixed(2)} SOL
                  </span>
                </div>
                <div className="flex gap-2 justify-center">
                  <button onClick={takeInsurance} className="btn btn-primary px-5 py-2">
                    Take insurance
                  </button>
                  <button onClick={declineInsurance} className="btn btn-ghost px-5 py-2">
                    Decline
                  </button>
                </div>
              </div>
            )}
            {phase === "player" && (
              <div className="flex flex-wrap items-center justify-center gap-2 animate-slide-up">
                <button onClick={hit} className="btn btn-primary px-6 py-3">Hit</button>
                <button onClick={stand} className="btn btn-warning px-6 py-3">Stand</button>
                <button
                  onClick={doubleDown}
                  className={`btn px-6 py-3 ${
                    playerCards.length === 2 ? "btn-ghost" : "btn-ghost opacity-30 cursor-not-allowed"
                  }`}
                  disabled={playerCards.length !== 2}
                  title={playerCards.length !== 2 ? "Double down only on first two cards" : ""}
                >
                  Double Down
                </button>
              </div>
            )}
            {phase === "dealer" && (
              <div className="text-sm font-mono animate-pulse-slow" style={{ color: "var(--muted)" }}>
                Dealer playing…
              </div>
            )}
            {phase === "done" && outcome && (
              <div className="text-center animate-pop">
                <div
                  className="font-display text-3xl font-bold"
                  style={{
                    color:
                      outcome === "win" || outcome === "bj"
                        ? "var(--accent)"
                        : outcome === "push"
                        ? "var(--warning)"
                        : "var(--danger)",
                  }}
                >
                  {outcome === "bj" && "Blackjack! 1.5x payout"}
                  {outcome === "win" && "You won!"}
                  {outcome === "lose" && "Dealer wins."}
                  {outcome === "push" && "Push — bet returned."}
                  {outcome === "bust" && "Bust — over 21."}
                </div>
                {insuranceResolved && (
                  <div
                    className="mt-2 text-sm font-semibold"
                    style={{
                      color: insuranceResolved === "won" ? "var(--accent)" : "var(--danger)",
                    }}
                  >
                    {insuranceResolved === "won"
                      ? `Insurance won: +${(insuranceBet * INSURANCE_PAYOUT).toFixed(2)} SOL`
                      : `Insurance lost: -${insuranceBet.toFixed(2)} SOL`}
                  </div>
                )}
                <button onClick={newRound} className="btn btn-primary px-6 py-2 mt-3">
                  New round
                </button>
              </div>
            )}
          </div>
          <PlayerHand cards={playerCards} value={playerValue} busted={playerValue > 21} />
        </div>
      </div>

      {phase === "bet" && (
        <div className="panel p-6 grid sm:grid-cols-3 gap-4 items-end">
          <div className="sm:col-span-2">
            <label className="stat-label block mb-2">Bet amount</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="stepper-btn"
                onClick={() => setBet(Math.max(0, +(bet - 0.1).toFixed(2)))}
                disabled={bet <= 0}
                aria-label="Decrease"
              >
                ↓
              </button>
              <div className="relative flex-1">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={bet}
                  onChange={(e) => setBet(parseFloat(e.target.value) || 0)}
                  className="input pr-14 text-lg font-semibold text-center"
                />
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono"
                  style={{ color: "var(--muted)" }}
                >
                  SOL
                </span>
              </div>
              <button
                type="button"
                className="stepper-btn"
                onClick={() => setBet(+(bet + 0.1).toFixed(2))}
                aria-label="Increase"
              >
                ↑
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex gap-1 flex-1">
                {[0.05, 0.1, 0.5, 1].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setBet(v)}
                    className="btn btn-ghost py-1 text-xs flex-1"
                  >
                    {v}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setBet(+balance.toFixed(2))}
                className="btn btn-ghost py-1 text-xs px-3"
              >
                MAX
              </button>
              <button
                type="button"
                onClick={() => setBet(+(bet / 2).toFixed(2))}
                className="btn btn-ghost py-1 text-xs px-3"
              >
                ½
              </button>
            </div>
            {error && (
              <div
                className="text-sm px-3 py-2 rounded-lg mt-2"
                style={{
                  background: "color-mix(in srgb, var(--danger) 12%, transparent)",
                  color: "var(--danger)",
                  border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)",
                }}
              >
                {error}
              </div>
            )}
          </div>
          <button onClick={deal} className="btn btn-primary py-4 text-base">
            Deal
          </button>
        </div>
      )}

      {round && (
        <div className="panel p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="chip chip-accent">Verifiable</span>
            <span className="text-sm font-semibold">Round seed-chain</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs font-mono">
            <Row label="server_seed" value={round.serverSeed} accent />
            <Row label="server_hash (commit)" value={round.serverSeedHash} accent />
            <Row label="client_seed" value={round.clientSeed} accent />
            <Row label="client_hash" value={round.clientSeedHash} accent />
            <Row label="nonce" value={String(round.nonce)} />
            <Row label="first 8 cards" value={deck.slice(0, 8).join(", ")} accent />
          </div>
          <p className="text-xs mt-4" style={{ color: "var(--muted)" }}>
            Verify: HMAC-SHA-256(server_seed, client_seed || nonce) → bytes
            feed a Fisher-Yates shuffle. Drawn cards = deck in order.
          </p>
        </div>
      )}
    </div>
  );
}

function DealerHand({
  cards, holeRevealed, value, insuranceWon, insuranceLost,
}: { cards: number[]; holeRevealed: boolean; value: number | null; insuranceWon: boolean; insuranceLost: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="stat-label">Dealer</span>
        {value !== null && (
          <span className="font-mono font-bold text-lg" style={{ color: "var(--text)" }}>
            {value}
          </span>
        )}
        {insuranceWon && (
          <span className="chip chip-accent" style={{ fontSize: 9 }}>
            Insurance paid
          </span>
        )}
        {insuranceLost && (
          <span className="chip chip-danger" style={{ fontSize: 9 }}>
            Insurance lost
          </span>
        )}
      </div>
      <div className="flex gap-2 flex-wrap min-h-[8rem]">
        {cards.length === 0 && <EmptySlot />}
        {cards.map((c, i) => {
          const isHole = i === 1 && !holeRevealed;
          if (isHole) return <CardBack key={i} delayMs={i * 80} />;
          const { rank, suit, red } = cardName(c);
          return <Card key={i} rank={rank} suit={suit} red={red} delayMs={i * 80} />;
        })}
      </div>
    </div>
  );
}

function PlayerHand({ cards, value, busted }: { cards: number[]; value: number; busted: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="stat-label">Player</span>
        {cards.length > 0 && (
          <span
            className="font-mono font-bold text-lg"
            style={{ color: busted ? "var(--danger)" : "var(--text)" }}
          >
            {value}
          </span>
        )}
        {busted && (
          <span className="chip chip-danger" style={{ fontSize: 9 }}>
            BUST
          </span>
        )}
      </div>
      <div className="flex gap-2 flex-wrap min-h-[8rem]">
        {cards.length === 0 && <EmptySlot />}
        {cards.map((c, i) => {
          const { rank, suit, red } = cardName(c);
          return <Card key={i} rank={rank} suit={suit} red={red} delayMs={i * 80} />;
        })}
      </div>
    </div>
  );
}

function EmptySlot() {
  return (
    <div
      className="w-20 sm:w-24 h-28 sm:h-32 rounded-lg border-2 border-dashed flex items-center justify-center"
      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
    >
      <span className="text-xs uppercase tracking-wider">—</span>
    </div>
  );
}

function Card({ rank, suit, red, delayMs }: { rank: string; suit: string; red: boolean; delayMs: number }) {
  return (
    <div
      className="card-flip relative w-20 sm:w-24 h-28 sm:h-32 rounded-lg shadow-soft font-display font-bold select-none"
      style={{ animationDelay: `${delayMs}ms`, animationFillMode: "backwards" }}
    >
      <div className="card-inner">
        <div
          className="card-face card-front flex flex-col items-center justify-center"
          style={{
            background: "linear-gradient(160deg, #ffffff 0%, #f4f4f8 100%)",
            color: red ? "#dc2626" : "#0f1116",
          }}
        >
          <div className="absolute top-2 left-2 text-xs leading-none flex flex-col items-center">
            <span>{rank}</span>
            <span className="text-base -mt-0.5">{suit}</span>
          </div>
          <div className="text-3xl sm:text-4xl">{suit}</div>
          <div className="absolute bottom-2 right-2 text-xs leading-none flex flex-col items-center rotate-180">
            <span>{rank}</span>
            <span className="text-base -mt-0.5">{suit}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardBack({ delayMs }: { delayMs: number }) {
  return (
    <div
      className="card-flip relative w-20 sm:w-24 h-28 sm:h-32 rounded-lg shadow-soft flex items-center justify-center"
      style={{ animationDelay: `${delayMs}ms`, animationFillMode: "backwards" }}
    >
      <div
        className="absolute inset-0 rounded-lg"
        style={{
          background: "linear-gradient(135deg, #4338ca 0%, #7c3aed 50%, #4338ca 100%)",
          border: "2px solid color-mix(in srgb, var(--accent2) 50%, transparent)",
        }}
      >
        <div className="w-full h-full flex items-center justify-center">
          <div
            className="w-12 h-16 rounded border-2"
            style={{
              borderColor: "rgba(255,255,255,0.4)",
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(255,255,255,0.1) 0, rgba(255,255,255,0.1) 4px, transparent 4px, transparent 8px)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="stat-label">{label}</span>
      <span
        className="break-all truncate"
        title={value}
        style={{ color: accent ? "var(--accent)" : "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="font-mono font-bold text-lg mt-0.5" style={{ color }}>
        {value}
      </div>
    </div>
  );
}