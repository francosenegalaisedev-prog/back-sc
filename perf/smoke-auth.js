import { check, sleep } from "k6";
import http from "k6/http";
import { login } from "./lib/auth.js";

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) throw new Error("BASE_URL manquante");

export const options = {
  vus: 1,
  duration: "10s",
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  console.log("Setup: login pour obtenir le token");
  return { token: login(BASE_URL) }; // exécuté une seule fois
}

// exécuté par chaque VU ( iteration function)
export default function (data) {
  const params = { headers: { Authorization: `Bearer ${data.token}` } };

  const liste = http.get(`${BASE_URL}/api/client/dashboard/fiches`, params);
  check(liste, { "liste 200": (r) => r.status === 200 });

  sleep(1);
}
