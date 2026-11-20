import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ficheFindUnique: vi.fn(),
  ficheUpdate: vi.fn(),
  ficheUpdateMany: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  txQueryRaw: vi.fn(),
  txExecuteRaw: vi.fn(),
  transaction: vi.fn(),
  getPublicSubscription: vi.fn(),
}));

vi.mock("../../../database/prisma/prisma-client", () => ({
  prisma: {
    fiche: {
      findUnique: mocks.ficheFindUnique,
      update: mocks.ficheUpdate,
      updateMany: mocks.ficheUpdateMany,
    },
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
  },
}));

vi.mock("./fiche-public-access", () => ({
  getPublicSubscription: mocks.getPublicSubscription,
}));

import { ScansService } from "../../scans/scans.service";
import { PassageService } from "./passages.service";

describe("Incrément scansTotal sans modifier fiche.updatedAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PassageService.record incrémente scansTotal via $executeRaw sans appeler fiche.update", async () => {
    mocks.ficheFindUnique.mockResolvedValue({
      id: 42,
      userId: 7,
      statut: "ACTIVE",
    });
    mocks.getPublicSubscription.mockResolvedValue({ id: 1 });
    mocks.queryRaw.mockResolvedValue([]);
    mocks.txQueryRaw.mockResolvedValue([{ id: 100 }]);
    mocks.txExecuteRaw.mockResolvedValue(1);
    mocks.transaction.mockImplementation(async cb =>
      cb({
        $queryRaw: mocks.txQueryRaw,
        $executeRaw: mocks.txExecuteRaw,
        fiche: { update: mocks.ficheUpdate },
      })
    );

    const res = await PassageService.record(
      "le-sunset",
      "QR",
      "idempotency_key_1234567890"
    );

    expect(res).toEqual({ recorded: true });
    expect(mocks.txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mocks.ficheUpdate).not.toHaveBeenCalled();
  });

  it("ScansService.enregistrer incrémente scansTotal via $executeRaw sans appeler fiche.updateMany", async () => {
    mocks.executeRaw.mockResolvedValue(1);

    await ScansService.enregistrer(
      "le-sunset",
      "192.168.1.42",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
    );

    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.ficheUpdateMany).not.toHaveBeenCalled();
  });
});
