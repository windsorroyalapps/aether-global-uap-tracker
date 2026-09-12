import { fileLocalReport, loadLocalSightings, STATIC_AI_UNAVAILABLE } from "./local";
import type { Analysis, ReportInput, Sighting } from "./types";

export const isStaticHost = import.meta.env.VITE_STATIC === "true";

export async function fetchSightings(): Promise<Sighting[]> {
  if (isStaticHost) return loadLocalSightings();
  const { listSightings } = await import("./queries");
  return listSightings();
}

export async function submitReport(input: ReportInput): Promise<Sighting> {
  if (isStaticHost) return fileLocalReport(input);
  const { fileReport } = await import("./queries");
  return fileReport({ data: input });
}

export async function fetchAnalysis(id: number): Promise<Analysis | null> {
  if (isStaticHost) return null;
  const { getAnalysis } = await import("./analyze");
  return getAnalysis({ data: { id } });
}

export async function runAnalysis(
  id: number,
): Promise<Analysis | { error: string }> {
  if (isStaticHost) return { error: STATIC_AI_UNAVAILABLE };
  const { analyzeContact } = await import("./analyze");
  return analyzeContact({ data: { id } });
}

export async function runBriefing(): Promise<{ text: string } | { error: string }> {
  if (isStaticHost) return { error: STATIC_AI_UNAVAILABLE };
  const { generateBriefing } = await import("./analyze");
  return generateBriefing();
}
