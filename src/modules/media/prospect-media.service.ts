import { randomUUID } from "node:crypto";
import { env } from "../../config/env";
import { s3Storage } from "../../infrastructure/storage/s3.storage";
import { notFound, unprocessable } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { optimizeMedia } from "./media.processor";
import {
  MEDIA_FORMATS,
  mediaMaxBytes,
  validateMediaSignature,
  type SupportedMediaMime,
} from "./media.validation";

const PREFIX = "prospects/";
const AUDIO_MAX_BYTES = 3 * 1024 * 1024; // 3 Mo (~60s d'audio vocal)

export const PROSPECT_MEDIA_FILE =
  /^[0-9a-f-]{36}\.(jpg|png|webp|webm|m4a|ogg|mp3)$/i;

const PROSPECT_MEDIA_REF =
  /^(?:https?:\/\/[^/\s]+)?(\/api\/media\/prospects\/([0-9a-f-]{36}\.(jpg|png|webp|webm|m4a|ogg|mp3)))$/i;

const AUDIO_FORMATS = {
  "audio/webm": { extension: "webm" },
  "audio/mp4": { extension: "m4a" },
  "audio/x-m4a": { extension: "m4a" },
  "audio/ogg": { extension: "ogg" },
  "audio/mpeg": { extension: "mp3" },
} as const;

type SupportedAudioMime = keyof typeof AUDIO_FORMATS;

const apiOrigin = () => env.SERVER.replace(/\/api\/?$/, "").replace(/\/$/, "");

function hasAudioSignature(buffer: Buffer, mime: SupportedAudioMime): boolean {
  if (buffer.length < 4) return false;
  if (mime === "audio/webm") {
    return (
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    );
  }
  if (mime === "audio/ogg") {
    return buffer.subarray(0, 4).toString("ascii") === "OggS";
  }
  if (mime === "audio/mp4" || mime === "audio/x-m4a") {
    return (
      buffer.length >= 8 && buffer.subarray(4, 8).toString("ascii") === "ftyp"
    );
  }
  if (mime === "audio/mpeg") {
    const id3 = buffer.subarray(0, 3).toString("ascii") === "ID3";
    const frameSync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
    return id3 || frameSync;
  }
  return false;
}

export const ProspectMediaService = {
  extractRef(value: string | null | undefined): string | null {
    if (!value) return null;
    const match = PROSPECT_MEDIA_REF.exec(value.trim());
    return match ? match[1] : null;
  },

  toAbsolute(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("/api/media/prospects/")) {
      return `${apiOrigin()}${trimmed}`;
    }
    return trimmed;
  },

  async upload(body: Buffer, rawMime?: string) {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw unprocessable("FICHIER_VIDE", "Le fichier envoyé est vide.");
    }

    const mime = (rawMime ?? "").split(";")[0].trim().toLowerCase();

    if (mime in AUDIO_FORMATS) {
      const audioMime = mime as SupportedAudioMime;
      if (body.length > AUDIO_MAX_BYTES) {
        throw unprocessable(
          "AUDIO_TROP_LOURD",
          "La note vocale ne peut pas dépasser 3 Mo (60 secondes maximum)."
        );
      }
      if (!hasAudioSignature(body, audioMime)) {
        throw unprocessable(
          "FORMAT_AUDIO_INVALIDE",
          "Le fichier audio ne correspond pas au format déclaré."
        );
      }
      const { extension } = AUDIO_FORMATS[audioMime];
      const fileName = `${randomUUID()}.${extension}`;
      const storageKey = `${PREFIX}${fileName}`;
      await s3Storage().put({
        key: storageKey,
        body,
        contentType: audioMime,
      });
      const ref = `/api/media/prospects/${fileName}`;
      return {
        kind: "audio" as const,
        ref,
        url: `${apiOrigin()}${ref}`,
        contentType: audioMime,
        sizeBytes: body.length,
      };
    }

    if (
      mime in MEDIA_FORMATS &&
      MEDIA_FORMATS[mime as SupportedMediaMime].kind === "image"
    ) {
      const imgMime = mime as SupportedMediaMime;
      if (body.length > mediaMaxBytes("image")) {
        throw unprocessable(
          "MEDIA_TROP_LOURD",
          "Une photo ne peut pas dépasser 12 Mo."
        );
      }
      validateMediaSignature(body, imgMime);
      const optimized = await optimizeMedia(body, imgMime);
      const finalFormat = MEDIA_FORMATS[optimized.mime];
      if (optimized.body.length > mediaMaxBytes("image")) {
        throw unprocessable(
          "MEDIA_TROP_LOURD_APRES_OPTIMISATION",
          "La photo optimisée dépasse 12 Mo."
        );
      }
      const fileName = `${randomUUID()}.${finalFormat.extension}`;
      const storageKey = `${PREFIX}${fileName}`;
      await s3Storage().put({
        key: storageKey,
        body: optimized.body,
        contentType: optimized.mime,
      });
      const ref = `/api/media/prospects/${fileName}`;
      return {
        kind: "image" as const,
        ref,
        url: `${apiOrigin()}${ref}`,
        contentType: optimized.mime,
        sizeBytes: optimized.body.length,
      };
    }

    throw unprocessable(
      "FORMAT_MEDIA_INVALIDE",
      "Formats acceptés : photo (JPEG, PNG, WebP) ou audio vocal (WebM, MP4/M4A, OGG, MP3)."
    );
  },

  async getPublic(fileName: string, range?: string) {
    if (!PROSPECT_MEDIA_FILE.test(fileName)) {
      throw notFound("Média introuvable");
    }
    const obj = await s3Storage().get(`${PREFIX}${fileName}`, range);
    if (!obj) {
      throw notFound("Média introuvable");
    }
    return {
      ...obj,
      contentType: obj.contentType ?? "application/octet-stream",
    };
  },

  async deleteRef(ref: string | null | undefined) {
    const normalized = this.extractRef(ref);
    if (!normalized) return;
    const fileName = normalized.replace(/^\/api\/media\/prospects\//i, "");
    try {
      await s3Storage().delete(`${PREFIX}${fileName}`);
    } catch (error) {
      logger.warn(`Suppression du média prospect impossible (${fileName})`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
