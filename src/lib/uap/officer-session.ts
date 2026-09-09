export const OFFICER_KEY = "aether-officer-session";

export type OfficerSession = {
  token: string;
  callsign: string;
};

export function loadOfficer(): OfficerSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(OFFICER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfficerSession;
    if (!parsed.token || !parsed.callsign) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveOfficer(session: OfficerSession) {
  localStorage.setItem(OFFICER_KEY, JSON.stringify(session));
}

export function clearOfficer() {
  localStorage.removeItem(OFFICER_KEY);
}
