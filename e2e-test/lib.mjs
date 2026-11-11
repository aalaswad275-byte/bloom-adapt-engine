import fs from "node:fs";

export const URL = "https://dependable-goldfish-963.convex.cloud";
export const STATE = "/tmp/e2e/state.json";
export const ADMIN_EMAIL = "admin@epc.ly";
export const ADMIN_PASSWORD = "Assessment123!@#";

export function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}
export function save(state) {
  fs.mkdirSync("/tmp/e2e", { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
}

export async function call(kind, path, args, token) {
  const res = await fetch(`${URL}/api/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ path, args: args ?? {}, format: "json" }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  if (json.status === "error") {
    const raw = String(json.errorMessage ?? "").replace(/\[[^\]]*\]\s*/g, "");
    const line =
      raw.split("\n").find((l) => l.includes("Uncaught Error:")) ??
      raw.split("\n")[0];
    throw new Error(`${path}: ${line.slice(0, 500)}`);
  }
  return json.value;
}
export const q = (path, args, token) => call("query", path, args, token);
export const mut = (path, args, token) => call("mutation", path, args, token);
export const act = (path, args, token) => call("action", path, args, token);

export async function adminToken() {
  const res = await act("auth:signIn", {
    provider: "password",
    params: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, flow: "signIn" },
  });
  const token = res?.tokens?.token;
  if (!token) throw new Error("admin sign-in failed");
  return token;
}

export async function anonymousToken() {
  const res = await act("auth:signIn", { provider: "anonymous", params: {} });
  const token = res?.tokens?.token;
  if (!token) throw new Error("anonymous sign-in failed");
  return token;
}

/** Upload a tiny PNG through a student session and return its storage id. */
export async function uploadImage(token) {
  const url = await mut(
    "studentAssessments:generateIdentityUploadUrl",
    {},
    token,
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  if (!res.ok) throw new Error(`upload failed ${res.status}`);
  const json = await res.json();
  return json.storageId;
}

export const FACE_POSES = [
  "center",
  "slight_left",
  "slight_right",
  "far_left",
  "far_right",
  "slight_up",
  "slight_down",
];

export function log(...parts) {
  console.log(...parts);
}
