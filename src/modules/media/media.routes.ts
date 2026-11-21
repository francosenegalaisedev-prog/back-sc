import { Router } from "express";
import { validate } from "../../middlewares/validate";
import { MediaController } from "./media.controller";
import {
  cardImageParams,
  prospectMediaParams,
  publicMediaParams,
} from "./media.validation";

export const mediaRouter = Router();

// Avant la route générique : « cartes » et « prospects » ne doivent pas être lus comme des identifiants de fiche.
mediaRouter.get(
  "/cartes/:fileName",
  validate({ params: cardImageParams }),
  MediaController.getCardImage
);

mediaRouter.get(
  "/prospects/:fileName",
  validate({ params: prospectMediaParams }),
  MediaController.getProspectMedia
);

mediaRouter.get(
  "/:ficheId/:key",
  validate({ params: publicMediaParams }),
  MediaController.getPublic
);
