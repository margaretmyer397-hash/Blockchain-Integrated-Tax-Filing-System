// tests/filing-manager.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  uintCV,
  stringAsciiCV,
  listCV,
  someCV,
  noneCV,
  principalCV,
} from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_FILING_EXISTS = 102;
const ERR_FILING_NOT_FOUND = 103;
const ERR_INVALID_IPFS_HASH = 104;
const ERR_INVALID_TAX_YEAR = 105;
const ERR_MAX_DEDUCTIONS = 110;
const ERR_STATUS_TRANSITION = 107;
const ERR_CONTRACT_NOT_INITIALIZED = 113;
const ERR_PAUSED = 114;

interface Filing {
  taxpayer: string;
  taxYear: number;
  ipfsHash: string;
  status: string;
  submittedAt: number;
  deductionIds: number[];
  auditFlags: number;
}

interface ContractStatus {
  owner: string;
  paused: boolean;
  nextId: number;
  deadlineEnforcer: string | null;
  auditEngine: string | null;
}

class FilingManagerMock {
  state: {
    contractOwner: string;
    nextFilingId: number;
    isPaused: boolean;
    deadlineEnforcer: string | null;
    auditEngine: string | null;
    filings: Map<number, Filing>;
    filingByTaxpayerYear: Map<string, number>;
    statusHistory: Map<
      number,
      Array<{ status: string; block: number; updater: string }>
    >;
  } = {
    contractOwner: "ST1OWNER",
    nextFilingId: 0,
    isPaused: false,
    deadlineEnforcer: null,
    auditEngine: null,
    filings: new Map(),
    filingByTaxpayerYear: new Map(),
    statusHistory: new Map(),
  };

  blockHeight: number = 1000;
  caller: string = "ST1TAXPAYER";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      contractOwner: "ST1OWNER",
      nextFilingId: 0,
      isPaused: false,
      deadlineEnforcer: null,
      auditEngine: null,
      filings: new Map(),
      filingByTaxpayerYear: new Map(),
      statusHistory: new Map(),
    };
    this.blockHeight = 1000;
    this.caller = "ST1TAXPAYER";
  }

  isContractOwner(): boolean {
    return this.caller === this.state.contractOwner;
  }

  isDeadlineEnforcer(): boolean {
    return this.state.deadlineEnforcer === this.caller;
  }

  isAuditEngine(): boolean {
    return this.state.auditEngine === this.caller;
  }

  validateIpfsHash(hash: string): boolean {
    return hash.length === 46 && hash.startsWith("Qm");
  }

  initialize(
    deadlinePrincipal: string,
    auditPrincipal: string
  ): { ok: boolean; value?: boolean } {
    if (!this.isContractOwner())
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.deadlineEnforcer !== null)
      return { ok: false, value: ERR_CONTRACT_NOT_INITIALIZED };
    this.state.deadlineEnforcer = deadlinePrincipal;
    this.state.auditEngine = auditPrincipal;
    return { ok: true, value: true };
  }

  submitTaxFiling(
    taxYear: number,
    ipfsHash: string,
    deductionIds: number[]
  ): { ok: boolean; value?: number } {
    if (this.state.isPaused) return { ok: false, value: ERR_PAUSED };
    if (!this.state.deadlineEnforcer || !this.state.auditEngine)
      return { ok: false, value: ERR_CONTRACT_NOT_INITIALIZED };
    if (taxYear <= 2020) return { ok: false, value: ERR_INVALID_TAX_YEAR };
    if (!this.validateIpfsHash(ipfsHash))
      return { ok: false, value: ERR_INVALID_IPFS_HASH };
    if (deductionIds.length > 20)
      return { ok: false, value: ERR_MAX_DEDUCTIONS };
    const key = `${this.caller}-${taxYear}`;
    if (this.state.filingByTaxpayerYear.has(key))
      return { ok: false, value: ERR_FILING_EXISTS };

    const filingId = this.state.nextFilingId;
    const filing: Filing = {
      taxpayer: this.caller,
      taxYear,
      ipfsHash,
      status: "submitted",
      submittedAt: this.blockHeight,
      deductionIds,
      auditFlags: 0,
    };
    this.state.filings.set(filingId, filing);
    this.state.filingByTaxpayerYear.set(key, filingId);
    this.state.statusHistory.set(filingId, [
      { status: "submitted", block: this.blockHeight, updater: this.caller },
    ]);
    this.state.nextFilingId++;
    return { ok: true, value: filingId };
  }

  getFiling(filingId: number): Filing | null {
    return this.state.filings.get(filingId) || null;
  }

  getFilingByTaxpayerYear(taxpayer: string, taxYear: number): number | null {
    return (
      this.state.filingByTaxpayerYear.get(`${taxpayer}-${taxYear}`) || null
    );
  }

  flagForAudit(filingId: number): { ok: boolean; value?: boolean } {
    if (!this.isAuditEngine()) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const filing = this.state.filings.get(filingId);
    if (!filing) return { ok: false, value: ERR_FILING_NOT_FOUND };
    if (filing.status === "under-audit")
      return { ok: false, value: ERR_STATUS_TRANSITION };
    filing.status = "under-audit";
    filing.auditFlags += 1;
    this.state.statusHistory
      .get(filingId)
      ?.push({
        status: "under-audit",
        block: this.blockHeight,
        updater: this.caller,
      });
    return { ok: true, value: true };
  }

  approveFiling(filingId: number): { ok: boolean; value?: boolean } {
    if (!this.isAuditEngine() && !this.isDeadlineEnforcer())
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    const filing = this.state.filings.get(filingId);
    if (!filing) return { ok: false, value: ERR_FILING_NOT_FOUND };
    if (filing.status !== "under-audit")
      return { ok: false, value: ERR_STATUS_TRANSITION };
    filing.status = "approved";
    this.state.statusHistory
      .get(filingId)
      ?.push({
        status: "approved",
        block: this.blockHeight,
        updater: this.caller,
      });
    return { ok: true, value: true };
  }

  disputeFiling(filingId: number): { ok: boolean; value?: boolean } {
    const filing = this.state.filings.get(filingId);
    if (!filing) return { ok: false, value: ERR_FILING_NOT_FOUND };
    if (filing.taxpayer !== this.caller)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (!["under-audit", "rejected"].includes(filing.status))
      return { ok: false, value: ERR_STATUS_TRANSITION };
    filing.status = "disputed";
    this.state.statusHistory
      .get(filingId)
      ?.push({
        status: "disputed",
        block: this.blockHeight,
        updater: this.caller,
      });
    return { ok: true, value: true };
  }

  pauseContract(): { ok: boolean; value?: boolean } {
    if (!this.isContractOwner())
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.isPaused = true;
    return { ok: true, value: true };
  }

  unpauseContract(): { ok: boolean; value?: boolean } {
    if (!this.isContractOwner())
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.isPaused = false;
    return { ok: true, value: true };
  }

  getContractStatus(): { ok: boolean; value: ContractStatus } {
    return {
      ok: true,
      value: {
        owner: this.state.contractOwner,
        paused: this.state.isPaused,
        nextId: this.state.nextFilingId,
        deadlineEnforcer: this.state.deadlineEnforcer,
        auditEngine: this.state.auditEngine,
      },
    };
  }
}

describe("FilingManager", () => {
  let mock: FilingManagerMock;

  beforeEach(() => {
    mock = new FilingManagerMock();
    mock.reset();
  });

  it("initializes contract correctly", () => {
    mock.caller = "ST1OWNER";
    const result = mock.initialize("ST1DEADLINE", "ST1AUDIT");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const status = mock.getContractStatus();
    expect(status.value.deadlineEnforcer).toBe("ST1DEADLINE");
    expect(status.value.auditEngine).toBe("ST1AUDIT");
  });

  it("rejects initialization by non-owner", () => {
    const result = mock.initialize("ST1DEADLINE", "ST1AUDIT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects duplicate initialization", () => {
    mock.caller = "ST1OWNER";
    mock.initialize("ST1DEADLINE", "ST1AUDIT");
    const result = mock.initialize("ST2DEADLINE", "ST2AUDIT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CONTRACT_NOT_INITIALIZED);
  });

  it("rejects submission when paused", () => {
    mock.caller = "ST1OWNER";
    mock.initialize("ST1DEADLINE", "ST1AUDIT");
    mock.pauseContract();
    mock.caller = "ST1TAXPAYER";
    const result = mock.submitTaxFiling(
      2025,
      "QmValidHash123456789012345678901234567890123",
      []
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("rejects invalid IPFS hash", () => {
    mock.caller = "ST1OWNER";
    mock.initialize("ST1DEADLINE", "ST1AUDIT");
    mock.caller = "ST1TAXPAYER";
    const result = mock.submitTaxFiling(2025, "InvalidHash", []);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_IPFS_HASH);
  });

  it("pauses and unpauses contract", () => {
    mock.caller = "ST1OWNER";
    mock.pauseContract();
    expect(mock.state.isPaused).toBe(true);
    mock.unpauseContract();
    expect(mock.state.isPaused).toBe(false);
  });

  it("returns correct contract status", () => {
    mock.caller = "ST1OWNER";
    mock.initialize("ST1DEADLINE", "ST1AUDIT");
    const status = mock.getContractStatus();
    expect(status.ok).toBe(true);
    expect(status.value.owner).toBe("ST1OWNER");
    expect(status.value.nextId).toBe(0);
    expect(status.value.deadlineEnforcer).toBe("ST1DEADLINE");
  });
});
