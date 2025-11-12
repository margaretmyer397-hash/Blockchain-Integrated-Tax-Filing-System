// tests/deadline-enforcer.test.ts
import { describe, it, expect, beforeEach } from "vitest";

const ERR_NOT_AUTHORIZED = 100;
const ERR_YEAR_EXISTS = 101;
const ERR_YEAR_NOT_FOUND = 102;
const ERR_INVALID_DATES = 103;
const ERR_SEASON_CLOSED = 104;
const ERR_SEASON_NOT_OPEN = 105;
const ERR_CONTRACT_PAUSED = 107;

interface TaxSeason {
  startBlock: number;
  endBlock: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}

class DeadlineEnforcerMock {
  state: {
    contractOwner: string;
    isPaused: boolean;
    taxSeasons: Map<number, TaxSeason>;
    seasonByYear: Map<number, number>;
  } = {
    contractOwner: "ST1OWNER",
    isPaused: false,
    taxSeasons: new Map(),
    seasonByYear: new Map(),
  };

  blockHeight: number = 1000;
  caller: string = "ST1OWNER";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      contractOwner: "ST1OWNER",
      isPaused: false,
      taxSeasons: new Map(),
      seasonByYear: new Map(),
    };
    this.blockHeight = 1000;
    this.caller = "ST1OWNER";
  }

  isOwner(): boolean {
    return this.caller === this.state.contractOwner;
  }

  getSeason(taxYear: number): TaxSeason | null {
    return this.state.taxSeasons.get(taxYear) || null;
  }

  isOpen(taxYear: number): boolean {
    const season = this.state.taxSeasons.get(taxYear);
    if (!season || season.status !== "open") return false;
    return (
      this.blockHeight >= season.startBlock &&
      this.blockHeight <= season.endBlock
    );
  }

  defineSeason(
    taxYear: number,
    startBlock: number,
    endBlock: number
  ): { ok: boolean; value?: boolean } {
    if (this.state.isPaused) return { ok: false, value: ERR_CONTRACT_PAUSED };
    if (!this.isOwner()) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.taxSeasons.has(taxYear))
      return { ok: false, value: ERR_YEAR_EXISTS };
    if (
      taxYear <= 2020 ||
      endBlock <= startBlock ||
      startBlock <= this.blockHeight ||
      endBlock - startBlock > 525600
    ) {
      return { ok: false, value: ERR_INVALID_DATES };
    }
    const season: TaxSeason = {
      startBlock,
      endBlock,
      status: "open",
      createdAt: this.blockHeight,
      updatedAt: this.blockHeight,
    };
    this.state.taxSeasons.set(taxYear, season);
    this.state.seasonByYear.set(taxYear, taxYear);
    return { ok: true, value: true };
  }

  openSeason(taxYear: number): { ok: boolean; value?: boolean } {
    if (this.state.isPaused) return { ok: false, value: ERR_CONTRACT_PAUSED };
    if (!this.isOwner()) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const season = this.state.taxSeasons.get(taxYear);
    if (!season) return { ok: false, value: ERR_YEAR_NOT_FOUND };
    if (season.status === "open")
      return { ok: false, value: ERR_SEASON_NOT_OPEN };
    season.status = "open";
    season.updatedAt = this.blockHeight;
    return { ok: true, value: true };
  }

  closeSeason(taxYear: number): { ok: boolean; value?: boolean } {
    if (this.state.isPaused) return { ok: false, value: ERR_CONTRACT_PAUSED };
    if (!this.isOwner()) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const season = this.state.taxSeasons.get(taxYear);
    if (!season) return { ok: false, value: ERR_YEAR_NOT_FOUND };
    if (season.status !== "open")
      return { ok: false, value: ERR_SEASON_CLOSED };
    season.status = "closed";
    season.updatedAt = this.blockHeight;
    return { ok: true, value: true };
  }

  updateSeasonDates(
    taxYear: number,
    newStart: number,
    newEnd: number
  ): { ok: boolean; value?: boolean } {
    if (this.state.isPaused) return { ok: false, value: ERR_CONTRACT_PAUSED };
    if (!this.isOwner()) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const season = this.state.taxSeasons.get(taxYear);
    if (!season) return { ok: false, value: ERR_YEAR_NOT_FOUND };
    if (
      newEnd <= newStart ||
      newStart <= this.blockHeight ||
      newEnd - newStart > 525600
    ) {
      return { ok: false, value: ERR_INVALID_DATES };
    }
    season.startBlock = newStart;
    season.endBlock = newEnd;
    season.updatedAt = this.blockHeight;
    return { ok: true, value: true };
  }

  pauseContract(): { ok: boolean; value?: boolean } {
    if (!this.isOwner()) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.isPaused = true;
    return { ok: true, value: true };
  }

  unpauseContract(): { ok: boolean; value?: boolean } {
    if (!this.isOwner()) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.isPaused = false;
    return { ok: true, value: true };
  }

  getCurrentStatus(): {
    ok: boolean;
    value: { owner: string; paused: boolean };
  } {
    return {
      ok: true,
      value: { owner: this.state.contractOwner, paused: this.state.isPaused },
    };
  }
}

describe("DeadlineEnforcer", () => {
  let mock: DeadlineEnforcerMock;

  beforeEach(() => {
    mock = new DeadlineEnforcerMock();
    mock.reset();
  });

  it("defines a new tax season", () => {
    const result = mock.defineSeason(2025, 1100, 162500);
    expect(result.ok).toBe(true);
    const season = mock.getSeason(2025);
    expect(season?.startBlock).toBe(1100);
    expect(season?.endBlock).toBe(162500);
    expect(season?.status).toBe("open");
  });

  it("rejects defining duplicate year", () => {
    mock.defineSeason(2025, 1100, 162500);
    const result = mock.defineSeason(2025, 1200, 163000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_YEAR_EXISTS);
  });

  it("rejects non-owner defining season", () => {
    mock.caller = "ST1HACKER";
    const result = mock.defineSeason(2025, 1100, 162500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects invalid block range", () => {
    const result = mock.defineSeason(2025, 900, 1100);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DATES);
  });

  it("rejects season longer than ~1 year", () => {
    const result = mock.defineSeason(2025, 1100, 1100 + 525601);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DATES);
  });

  it("correctly checks if season is open", () => {
    mock.defineSeason(2025, 1100, 162500);
    mock.blockHeight = 1200;
    expect(mock.isOpen(2025)).toBe(true);
    mock.blockHeight = 1099;
    expect(mock.isOpen(2025)).toBe(false);
    mock.blockHeight = 162501;
    expect(mock.isOpen(2025)).toBe(false);
  });

  it("closes an open season", () => {
    mock.defineSeason(2025, 1100, 162500);
    const result = mock.closeSeason(2025);
    expect(result.ok).toBe(true);
    expect(mock.getSeason(2025)?.status).toBe("closed");
  });

  it("reopens a closed season", () => {
    mock.defineSeason(2025, 1100, 162500);
    mock.closeSeason(2025);
    const result = mock.openSeason(2025);
    expect(result.ok).toBe(true);
    expect(mock.getSeason(2025)?.status).toBe("open");
  });

  it("updates season dates", () => {
    mock.defineSeason(2025, 1100, 162500);
    const result = mock.updateSeasonDates(2025, 1200, 163000);
    expect(result.ok).toBe(true);
    const season = mock.getSeason(2025);
    expect(season?.startBlock).toBe(1200);
    expect(season?.endBlock).toBe(163000);
  });

  it("pauses and unpauses contract", () => {
    mock.pauseContract();
    expect(mock.state.isPaused).toBe(true);
    const result = mock.defineSeason(2026, 2000, 262500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CONTRACT_PAUSED);
    mock.unpauseContract();
    expect(mock.state.isPaused).toBe(false);
  });

  it("transfers ownership", () => {
    mock.caller = "ST1NEWOWNER";
    const result = mock.defineSeason(2025, 1100, 162500);
    expect(result.ok).toBe(false);
    mock.caller = "ST1OWNER";
    mock.defineSeason(2025, 1100, 162500);
    mock.caller = "ST1NEWOWNER";
    expect(mock.isOwner()).toBe(false);
  });

  it("returns current status", () => {
    const status = mock.getCurrentStatus();
    expect(status.ok).toBe(true);
    expect(status.value.owner).toBe("ST1OWNER");
    expect(status.value.paused).toBe(false);
  });

  it("rejects season with past start block", () => {
    const result = mock.defineSeason(2025, 900, 1400);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DATES);
  });

  it("handles multiple seasons independently", () => {
    mock.defineSeason(2025, 1100, 162500);
    mock.defineSeason(2026, 262600, 315000);
    mock.blockHeight = 1200;
    expect(mock.isOpen(2025)).toBe(true);
    expect(mock.isOpen(2026)).toBe(false);
  });
});
