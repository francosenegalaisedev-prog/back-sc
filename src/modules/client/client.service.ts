import { prisma } from "../../database/prisma/prisma-client";
import { AuthUser } from "../../types/user";
import { mediaUrl } from "../../lib/media";

export type DashboardFichesPagination = {
  page: number;
  limit: number;
};

const DASHBOARD_MAX_LIMIT = 100;

export const ClientService = {
  detailFiche: async (
    user: AuthUser,
    pagination?: DashboardFichesPagination
  ) => {
    const page = pagination ? Math.max(1, Math.floor(pagination.page)) : null;
    const limit = pagination
      ? Math.min(DASHBOARD_MAX_LIMIT, Math.max(1, Math.floor(pagination.limit)))
      : null;

    const getFiche = await prisma.fiche.findMany({
      where: { userId: user.id },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      ...(page && limit ? { skip: (page - 1) * limit, take: limit } : {}),
      include: {
        subscriptions: {
          where: {
            status: "ACTIVE",
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
          },
          orderBy: { startsAt: "desc" },
          take: 1,
          select: {
            startsAt: true,
            endsAt: true,
            status: true,
            plan: { select: { type: true } },
          },
        },
      },
    });

    const latestSubscriptions = getFiche.length
      ? await prisma.subscription.findMany({
          where: {
            ficheId: { in: getFiche.map(fiche => fiche.id) },
            status: { not: "PENDING" },
          },
          orderBy: [{ startsAt: "desc" }, { id: "desc" }],
          distinct: ["ficheId"],
          select: {
            ficheId: true,
            startsAt: true,
            endsAt: true,
            status: true,
            // Formule du dernier abonnement : permet de proposer le renouvellement de la même formule.
            plan: { select: { type: true } },
          },
        })
      : [];
    const latestByFicheId = new Map(
      latestSubscriptions.map(subscription => [
        subscription.ficheId,
        subscription,
      ])
    );

    return getFiche.map(fiche => ({
      ...fiche,
      latestSubscription: latestByFicheId.get(fiche.id) ?? null,
      logo: mediaUrl(fiche.logo),
      photo: mediaUrl(fiche.photo),
    }));
  },

  detailFichePaginated: async (
    user: AuthUser,
    pagination: DashboardFichesPagination
  ) => {
    const page = Math.max(1, Math.floor(pagination.page));
    const limit = Math.min(
      DASHBOARD_MAX_LIMIT,
      Math.max(1, Math.floor(pagination.limit))
    );
    const [total, items] = await Promise.all([
      prisma.fiche.count({ where: { userId: user.id } }),
      ClientService.detailFiche(user, { page, limit }),
    ]);
    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  },
};
