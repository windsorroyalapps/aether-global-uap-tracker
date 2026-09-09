const CALLSIGN = (process.env.OFFICER_USER || "Alert5").trim();
const PASS = process.env.OFFICER_PASS || "starwarsytrek1900s!";

function secret() {
  return process.env.OFFICER_SESSION_SECRET || process.env.ARCHIVE_ADMIN_KEY || `aether-floor:${CALLSIGN}`;
}

async function shaHex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function same(a: string, b: string) {
  const n = Math.max(a.length, b.length, 1);
  let out = a.length === b.length ? 0 : 1;
  for (let i = 0; i < n; i += 1) {
    out |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return out === 0;
}

async function digestEq(a: string, b: string) {
  const left = await shaHex(`x:${a}`);
  const right = await shaHex(`x:${b}`);
  return same(left, right);
}

async function issueOfficerTokenAt(user: string, day: number) {
  return (await shaHex(`${user}|${secret()}|${day}`)).slice(0, 40);
}

export async function issueOfficerToken(user: string) {
  return issueOfficerTokenAt(user, Math.floor(Date.now() / 86_400_000));
}

export async function officerTokenOk(token: string) {
  if (!token || token.length < 16) return false;
  const expected = process.env.ARCHIVE_ADMIN_KEY;
  if (expected && (await digestEq(token, expected))) return true;
  const day = Math.floor(Date.now() / 86_400_000);
  const today = await issueOfficerTokenAt(CALLSIGN, day);
  const yest = await issueOfficerTokenAt(CALLSIGN, day - 1);
  return same(token, today) || same(token, yest);
}

export async function loginOfficer(username: string, password: string) {
  const user = username.trim();
  const okUser = await digestEq(user, CALLSIGN);
  const okPass = await digestEq(password, PASS);
  if (!okUser || !okPass) {
    return { ok: false as const, error: "Watch officer credentials rejected." };
  }
  return { ok: true as const, token: await issueOfficerToken(CALLSIGN), callsign: CALLSIGN };
}

export async function readOfficerSession(token: string) {
  if (!(await officerTokenOk(token))) return { ok: false as const };
  return { ok: true as const, callsign: CALLSIGN };
}
