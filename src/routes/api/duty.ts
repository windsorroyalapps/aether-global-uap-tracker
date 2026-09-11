import { createFileRoute } from "@tanstack/react-router";
import { runDutyCycle } from "@/lib/uap/duty";

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET || process.env.DUTY_SECRET;
  if (!expected) return true;
  const auth = request.headers.get("authorization") ?? "";
  const q = new URL(request.url).searchParams.get("secret") ?? "";
  return auth === `Bearer ${expected}` || q === expected;
}

const handle = async ({ request }: { request: Request }) => {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runDutyCycle();
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "duty failed";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
};

export const Route = createFileRoute("/api/duty")({
  server: { handlers: { GET: handle, POST: handle } },
});
