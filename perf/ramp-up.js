import { check, sleep } from "k6";
import http from "k6/http";
import { login } from "./lib/auth.js";

// --- 1. CONFIGURATION & VALIDATION DES ENVIRONNEMENTS ---
const BASE_URL = __ENV.BASE_URL;
const FICHE_ID = __ENV.FICHE_ID;
const FICHE_SLUG = __ENV.FICHE_SLUG;

if (!BASE_URL || !FICHE_ID || !FICHE_SLUG) {
  throw new Error(
    "Variables d'environnement manquantes (BASE_URL, FICHE_ID, FICHE_SLUG)",
  );
}

// --- 2. OPTIONS DU TEST (STAGES & MÉTRIQUES) ---
export const options = {
  stages: [
    { duration: "30s", target: 10 }, // Montée progressive à 10 VUs
    { duration: "1m", target: 20 }, // Maintien à 20 VUs
    { duration: "20s", target: 0 }, // Redescente à 0 VU
  ],
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],

  thresholds: {
    http_req_duration: ["p(95)<500"],
    "http_req_duration{name:listes}": ["max>=0"],
    "http_req_duration{name:ficheDetail}": ["max>=0"],
    "http_req_duration{name:fichePubliqueQrCode}": ["max>=0"],
    "http_req_duration{name:fichePubliqueNFC}": ["max>=0"],
  },
};

// --- 3. PHASE DE SETUP (Exécuté 1 seule fois) ---
export function setup() {
  const token = login(BASE_URL);
  return { token };
}

// --- 4. SCÉNARIO PRINCIPAL (Exécuté en boucle par chaque VU) ---
export default function (data) {
  const token = data.token;

  // En-têtes d'authentification réutilisables
  const authHeaders = {
    headers: { Authorization: `Bearer ${token}` },
  };

  // --- A. Liste des fiches (Privé) ---
  const listesParams = {
    ...authHeaders,
    tags: { name: "listes" },
  };
  const listes = http.get(
    `${BASE_URL}/api/client/dashboard/fiches`,
    listesParams,
  );

  if (listes.status !== 200) {
    console.log(
      `listes -> ${listes.status} | Retry-After: ${listes.headers["Retry-After"]}`,
    );
  }
  check(listes, {
    "listes 200": (r) => r.status === 200,
  });

  // --- B. Détail d'une fiche (Privé) ---
  const ficheDetailParams = {
    ...authHeaders,
    tags: { name: "ficheDetail" },
  };
  const ficheDetail = http.get(
    `${BASE_URL}/api/fiches/${FICHE_ID}`,
    ficheDetailParams,
  );

  if (ficheDetail.status !== 200) {
    console.log(
      `ficheDetail -> ${ficheDetail.status} | Retry-After: ${ficheDetail.headers["Retry-After"]}`,
    );
  }
  check(ficheDetail, { "ficheDetail 200": (r) => r.status === 200 });

  // --- C. Fiche publique avec QR Code (Public) ---
  const publiqueQR = http.get(
    `${BASE_URL}/api/fiches/public/${FICHE_SLUG}?source=qr`,
    { tags: { name: "fichePubliqueQrCode" } },
  );

  if (publiqueQR.status !== 200) {
    console.log(
      `publiqueQR -> ${publiqueQR.status} | Retry-After: ${publiqueQR.headers["Retry-After"]}`,
    );
  }
  check(publiqueQR, { "fichePubliqueQrCode 200": (r) => r.status === 200 });

  // --- D. Fiche publique avec NFC (Public) ---
  const publiqueNFC = http.get(
    `${BASE_URL}/api/fiches/public/${FICHE_SLUG}?source=nfc`,
    { tags: { name: "fichePubliqueNFC" } },
  );

  if (publiqueNFC.status !== 200) {
    console.log(
      `publiqueNFC -> ${publiqueNFC.status} | Retry-After: ${publiqueNFC.headers["Retry-After"]}`,
    );
  }
  check(publiqueNFC, { "fichePubliqueNFC 200": (r) => r.status === 200 });

  // Pause d'une seconde entre chaque itération du VU
  sleep(1);
}
