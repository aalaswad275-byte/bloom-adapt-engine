/** Shared plumbing for the end-to-end suite (temporary; removed after the run). */
import { readFileSync } from "node:fs";

export const DEPLOY = "https://dependable-goldfish-963.convex.cloud";

type Tokens = Record<string, string>;

function loadTokens(): Tokens {
  const out: Tokens = {};
  for (const role of ["instructor", "other", "admin", "student", "guest"]) {
    try {
      const raw = JSON.parse(readFileSync(`/tmp/e2e/tok_${role}.json`, "utf8"));
      const t = raw?.tokens?.token ?? raw?.token;
      if (typeof t === "string") out[role] = t;
    } catch {
      /* role not signed in yet */
    }
  }
  return out;
}

export const tokens: Tokens = loadTokens();

async function call(
  kind: "query" | "mutation" | "action",
  path: string,
  args: Record<string, unknown>,
  token?: string | null,
) {
  const res = await fetch(`${DEPLOY}/api/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  if (!res.ok) {
    const msg =
      typeof body === "string"
        ? body
        : (body?.errorMessage ?? body?.message ?? JSON.stringify(body));
    const err = new Error(String(msg).split("\n")[0]);
    (err as any).status = res.status;
    (err as any).body = body;
    throw err;
  }
  return body !== null && typeof body === "object" && "value" in body
    ? body.value
    : body;
}

export const q = (path: string, args: Record<string, unknown> = {}, token: string | null = tokens.instructor!) =>
  call("query", path, args, token);
export const m = (path: string, args: Record<string, unknown> = {}, token: string | null = tokens.instructor!) =>
  call("mutation", path, args, token);
export const a = (path: string, args: Record<string, unknown> = {}, token: string | null = tokens.instructor!) =>
  call("action", path, args, token);

export type Result = {
  section: string;
  name: string;
  status: "pass" | "fail";
  detail?: string;
};

export const results: Result[] = [];
let currentSection = "General";

export function section(name: string) {
  currentSection = name;
  console.log(`\n### ${name}`);
}

export async function test(name: string, fn: () => Promise<void | string>) {
  try {
    const note = await fn();
    results.push({ section: currentSection, name, status: "pass", detail: note ?? undefined });
    console.log(`  PASS  ${name}${note ? ` — ${note}` : ""}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ section: currentSection, name, status: "fail", detail });
    console.log(`  FAIL  ${name} — ${detail}`);
  }
}

export function ok(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

export function eq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected)
    throw new Error(
      `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    );
}

export function near(actual: unknown, expected: number, tolerance: number, message: string) {
  if (typeof actual !== "number" || Math.abs(actual - expected) > tolerance)
    throw new Error(`${message} (expected ~${expected}±${tolerance}, got ${actual})`);
}

export async function failsWith(fn: () => Promise<unknown>, needle: string): Promise<string> {
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes(needle.toLowerCase()))
      throw new Error(`threw "${msg}" but expected it to contain "${needle}"`);
    return msg;
  }
  throw new Error(`expected a failure containing "${needle}" but the call succeeded`);
}

export function report(subtitle: string) {
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail");
  console.log(`\n${subtitle}: ${passed} passed, ${failed.length} failed`);
  for (const f of failed) console.log(` - ${f.section} / ${f.name}: ${f.detail}`);
  console.log("RESULTS_JSON " + JSON.stringify(results));
}

export function save(state: Record<string, unknown>) {
  const path = "/tmp/e2e/state.json";
  let prev: Record<string, unknown> = {};
  try {
    prev = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* first run */
  }
  require("node:fs").writeFileSync(path, JSON.stringify({ ...prev, ...state }, null, 2));
}

export function load<T = Record<string, any>>(): T {
  return JSON.parse(readFileSync("/tmp/e2e/state.json", "utf8")) as T;
}
