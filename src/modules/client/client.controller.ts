import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { AuthUser } from "../../types/user";
import { ClientService } from "./client.service";

// set DTO For DASH
export const ClientController = {
  getFichesDetail: asyncHandler(async (req: Request, res: Response) => {
    const hasPagination =
      req.query.page !== undefined || req.query.limit !== undefined;
    if (hasPagination) {
      const page = Number(req.query.page ?? 1);
      const limit = Number(req.query.limit ?? 20);
      const result = await ClientService.detailFichePaginated(
        req.user as AuthUser,
        {
          page: Number.isFinite(page) ? page : 1,
          limit: Number.isFinite(limit) ? limit : 20,
        }
      );
      return res.status(200).json(result);
    }

    const result = await ClientService.detailFiche(req.user as AuthUser);

    return res.status(200).json(result);
  }),
};
