import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/cms-api", () => ({
  fetchAllPages: vi.fn(),
}));

vi.mock("../lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { fetchAllPages } from "../lib/cms-api";
import { supabaseAdmin } from "../lib/supabase-admin";
import { main } from "../ingest-ownership";

let fromCallCount: number;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  fromCallCount = 0;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a chainable stub whose terminal awaitable resolves to { data, error }. */
function makeChain(resolved: { data: unknown; error: null }): Record<string, unknown> {
  const terminal = Promise.resolve(resolved);
  const chain: Record<string, unknown> = {};
  const self = (): typeof chain => chain;
  chain.select = self;
  chain.insert = self;
  chain.update = self;
  chain.delete = self;
  chain.eq = self;
  chain.neq = self;
  chain.in = self;
  chain.not = self;
  chain.range = () => terminal;
  // Make the chain itself thenable so `await supabaseAdmin.from(...).delete().neq(...)` resolves.
  chain.then = terminal.then.bind(terminal);
  chain.catch = terminal.catch.bind(terminal);
  return chain;
}

/** Success chain — resolves with empty data array. */
const successChain = () => makeChain({ data: [], error: null });

// ---------------------------------------------------------------------------
// Test 1 — matching normalized owner names → one operator, two links
// ---------------------------------------------------------------------------

describe("ingest-ownership pipeline", () => {
  let operatorInsertSpy: ReturnType<typeof vi.fn>;
  let providerOwnershipUpdateSpy: ReturnType<typeof vi.fn>;
  let providersUpdateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    operatorInsertSpy = vi.fn();
    providerOwnershipUpdateSpy = vi.fn();
    providersUpdateSpy = vi.fn();
  });

  it("groups matching normalized owner names into one operator and links both providers", async () => {
    vi.mocked(fetchAllPages).mockResolvedValue([
      {
        cms_certification_number_ccn: "100001",
        owner_name: "Sunrise Senior Living, LLC",
        owner_type: "Individual",
        ownership_percentage: "100",
        association_date: "01/01/2020",
      },
      {
        cms_certification_number_ccn: "100002",
        owner_name: "Sunrise Senior Living Inc",
        owner_type: "Individual",
        ownership_percentage: "100",
        association_date: "01/01/2020",
      },
    ]);

    // We use fromCallCount to discriminate repeated calls to the same table.
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      fromCallCount++;
      const callIndex = fromCallCount;

      // -----------------------------------------------------------------------
      // Phase 2: providers lookup (paginated via .range())
      // Call 1
      // -----------------------------------------------------------------------
      if (table === "providers" && callIndex === 1) {
        const data = [
          { id: "prov-1", cms_id: "100001" },
          { id: "prov-2", cms_id: "100002" },
        ];
        const pageChain: Record<string, unknown> = {};
        const terminal = Promise.resolve({ data, error: null });
        pageChain.select = () => pageChain;
        pageChain.range = () => terminal;
        pageChain.then = terminal.then.bind(terminal);
        pageChain.catch = terminal.catch.bind(terminal);
        return pageChain as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      // -----------------------------------------------------------------------
      // Phase 3 teardown
      // Call 2: provider_ownership delete
      // Call 3: providers update (operator_id null)
      // Call 4: operators delete
      // -----------------------------------------------------------------------
      if (table === "provider_ownership" && callIndex === 2) {
        return successChain() as unknown as ReturnType<typeof supabaseAdmin.from>;
      }
      if (table === "providers" && callIndex === 3) {
        return successChain() as unknown as ReturnType<typeof supabaseAdmin.from>;
      }
      if (table === "operators" && callIndex === 4) {
        return successChain() as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      // -----------------------------------------------------------------------
      // Phase 4: provider_ownership insert → returns inserted row IDs
      // Call 5
      // -----------------------------------------------------------------------
      if (table === "provider_ownership" && callIndex === 5) {
        const insertedRows = [{ id: "po-1" }, { id: "po-2" }];
        const insertChain: Record<string, unknown> = {};
        const terminal = Promise.resolve({ data: insertedRows, error: null });
        insertChain.insert = () => insertChain;
        insertChain.select = () => terminal;
        insertChain.then = terminal.then.bind(terminal);
        insertChain.catch = terminal.catch.bind(terminal);
        return insertChain as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      // -----------------------------------------------------------------------
      // Phase 5: fetch provider_ownership rows for operator matching (paginated)
      // Call 6
      // -----------------------------------------------------------------------
      if (table === "provider_ownership" && callIndex === 6) {
        const rows = [
          {
            id: "po-1",
            owner_name: "Sunrise Senior Living, LLC",
            provider_id: "prov-1",
          },
          {
            id: "po-2",
            owner_name: "Sunrise Senior Living Inc",
            provider_id: "prov-2",
          },
        ];
        const pageChain: Record<string, unknown> = {};
        const terminal = Promise.resolve({ data: rows, error: null });
        pageChain.select = () => pageChain;
        pageChain.range = () => terminal;
        pageChain.then = terminal.then.bind(terminal);
        pageChain.catch = terminal.catch.bind(terminal);
        return pageChain as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      // -----------------------------------------------------------------------
      // Phase 5: insert operator → returns new operator ID
      // Call 7
      // -----------------------------------------------------------------------
      if (table === "operators" && callIndex === 7) {
        const insertChain: Record<string, unknown> = {};
        const terminal = Promise.resolve({
          data: [{ id: "op-1" }],
          error: null,
        });
        operatorInsertSpy.mockImplementation(() => insertChain);
        insertChain.insert = operatorInsertSpy;
        insertChain.select = () => terminal;
        insertChain.then = terminal.then.bind(terminal);
        insertChain.catch = terminal.catch.bind(terminal);
        return insertChain as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      // -----------------------------------------------------------------------
      // Phase 5: update provider_ownership rows with operator_id
      // Call 8
      // -----------------------------------------------------------------------
      if (table === "provider_ownership" && callIndex === 8) {
        const updateChain: Record<string, unknown> = {};
        const terminal = Promise.resolve({ data: [], error: null });
        providerOwnershipUpdateSpy.mockImplementation(() => updateChain);
        updateChain.update = providerOwnershipUpdateSpy;
        updateChain.eq = () => terminal;
        updateChain.in = () => terminal;
        updateChain.then = terminal.then.bind(terminal);
        updateChain.catch = terminal.catch.bind(terminal);
        return updateChain as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      // -----------------------------------------------------------------------
      // Phase 5: update providers rows with operator_id
      // Call 9
      // -----------------------------------------------------------------------
      if (table === "providers" && callIndex === 9) {
        const updateChain: Record<string, unknown> = {};
        const terminal = Promise.resolve({ data: [], error: null });
        providersUpdateSpy.mockImplementation(() => updateChain);
        updateChain.update = providersUpdateSpy;
        updateChain.eq = () => terminal;
        updateChain.in = () => terminal;
        updateChain.then = terminal.then.bind(terminal);
        updateChain.catch = terminal.catch.bind(terminal);
        return updateChain as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      // Fallthrough — unexpected call: surface clearly in test output
      throw new Error(
        `Unexpected supabaseAdmin.from("${table}") at call #${callIndex}`,
      );
    });

    await expect(main()).resolves.toBeUndefined();

    // Operator inserted with alphabetically first raw name and facility_count: 2
    expect(operatorInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Sunrise Senior Living Inc", facility_count: 2 })
    );

    // Both provider_ownership rows linked to operator op-1
    expect(providerOwnershipUpdateSpy).toHaveBeenCalledWith({ operator_id: "op-1" });

    // Both providers linked to operator op-1
    expect(providersUpdateSpy).toHaveBeenCalledWith({ operator_id: "op-1" });
  });

  // -------------------------------------------------------------------------
  // Test 2 — zero-insert guard: Phase 4 returns 0 rows → process.exit(1)
  // -------------------------------------------------------------------------

  it("calls process.exit(1) when Phase 4 inserts zero rows", async () => {
    vi.mocked(fetchAllPages).mockResolvedValue([
      {
        cms_certification_number_ccn: "100001",
        owner_name: "Sunrise Senior Living, LLC",
        owner_type: "Individual",
        ownership_percentage: "100",
        association_date: "01/01/2020",
      },
    ]);

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string | null): never => {
        throw new Error("process.exit called");
      });

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      fromCallCount++;
      const callIndex = fromCallCount;

      // Phase 2: providers lookup
      if (table === "providers" && callIndex === 1) {
        const data = [{ id: "prov-1", cms_id: "100001" }];
        const pageChain: Record<string, unknown> = {};
        const terminal = Promise.resolve({ data, error: null });
        pageChain.select = () => pageChain;
        pageChain.range = () => terminal;
        pageChain.then = terminal.then.bind(terminal);
        pageChain.catch = terminal.catch.bind(terminal);
        return pageChain as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      // Phase 3 teardown (calls 2, 3, 4)
      if (
        (table === "provider_ownership" && callIndex === 2) ||
        (table === "providers" && callIndex === 3) ||
        (table === "operators" && callIndex === 4)
      ) {
        return successChain() as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      // Phase 4: provider_ownership insert → returns ZERO rows
      if (table === "provider_ownership" && callIndex === 5) {
        const insertChain: Record<string, unknown> = {};
        const terminal = Promise.resolve({ data: [], error: null });
        insertChain.insert = () => insertChain;
        insertChain.select = () => terminal;
        insertChain.then = terminal.then.bind(terminal);
        insertChain.catch = terminal.catch.bind(terminal);
        return insertChain as unknown as ReturnType<typeof supabaseAdmin.from>;
      }

      throw new Error(
        `Unexpected supabaseAdmin.from("${table}") at call #${callIndex}`,
      );
    });

    await expect(main()).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
