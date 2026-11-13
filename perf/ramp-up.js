import { check, sleep } from "k6";
import http from "k6/http";
import { login } from "./lib/auth.js";

const BASE_URL = __ENV.BASE_URL;
const FICHE_ID = __ENV.FICHE_ID;
const FICHE_SLUG = __ENV.FICHE_SLUG;
if (!BASE_URL || !FICHE_ID || !FICHE_SLUG)
  throw new Error("Variables d'environnement manquantes");

export const options = {
    vus: 1,
    duration: "20s",
    summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],

    //   stages: [
//     { duration: "30s", target: 10 }, // 1 VU pendant 30 secondes
//     { duration: "1m", target: 20 }, // 1 VU pendant 30 secondes
//     { duration: "20s", target: 0 }, // 1 VU pendant 30 secondes
//   ],
};

export function setup() {
  return { token: login(BASE_URL) }; // exécuté une seule fois
}

export default function (data) {
  const token = data.token;
  const param = { headers: { Authorization: `Bearer ${token}` } };

  // Liste des fiches
  const listes = http.get(`${BASE_URL}/api/client/dashboard/fiches`, param);
  if (listes.status !== 200) {
    console.log(
      `liste -> ${listes.status} | Retry-After: ${listes.headers["Retry-After"]}`,
    );
  }
  check(listes, { "liste 200": (r) => r.status === 200 });

  // detail fiche
  const ficheDetail = http.get(`${BASE_URL}/api/fiches/${FICHE_ID}`, param);
  if (ficheDetail.status !== 200) {
    console.log(
      `ficheDetail -> ${ficheDetail.status} | Retry-After: ${ficheDetail.headers["Retry-After"]}`,
    );
  }
  check(ficheDetail, { "ficheDetail 200": (r) => r.status === 200 });

  //  Fiche publique with qr
  const publiqueQR = http.get(
    `${BASE_URL}/api/fiches/public/${FICHE_SLUG}?source=qr`,
  );
  if (publiqueQR.status !== 200) {
    console.log(
      `publiqueQR -> ${publiqueQR.status} | Retry-After: ${publiqueQR.headers["Retry-After"]}`,
    );
  }
  check(publiqueQR, { "fichePubliqueQrCode 200": (r) => r.status === 200 });

  //  Fiche publique with NFC
  const publiqueNFC = http.get(
    `${BASE_URL}/api/fiches/public/${FICHE_SLUG}?source=nfc`,
  );

  if (publiqueNFC.status !== 200) {
    console.log(
      `publiqueNFC -> ${publiqueNFC.status} | Retry-After: ${publiqueNFC.headers["Retry-After"]}`,
    );
  }
  check(publiqueNFC, { "fichePubliqueNFC 200": (r) => r.status === 200 });

  sleep(1);
}
