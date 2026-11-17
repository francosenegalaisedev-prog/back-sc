import { check } from "k6";
import http from "k6/http";

export function login(baseUrl) {
  const email = __ENV.K6_EMAIL;
  const password = __ENV.K6_PASSWORD;
  if (!email || !password) {
    throw new Error("K6_EMAIL et K6_PASSWORD sont requis");
  }

  const res = http.post(
    `${baseUrl}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { "Content-Type": "application/json" } },
  );

  check(res, { "login 200": (r) => r.status === 200 });
  const body = res.json();
  const token = body.token || body.accessToken; // à adapter à ta réponse
  if (!token) {
    throw new Error("Token introuvable dans la réponse du login");
  }
  return token;
}
