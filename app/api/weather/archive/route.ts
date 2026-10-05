import { env } from "cloudflare:workers";
import { authorizedArchive } from "@/lib/github-archive-auth";
import { archiveWeather } from "../route";

export const dynamic = "force-dynamic";

function authorizedLocalArchive(request: Request) {
  if (new URL(request.url).hostname !== "127.0.0.1") return false;
  const expected = env.ECOWITT_LOCAL_ARCHIVE_TOKEN;
  const supplied = request.headers.get("authorization")?.match(/^Bearer ([0-9a-f]{64})$/i)?.[1];
  if (!expected || !supplied) return false;
  let difference = expected.length ^ supplied.length;
  for (let index = 0; index < expected.length; index++) {
    difference |= expected.charCodeAt(index) ^ (supplied.charCodeAt(index) ?? 0);
  }
  return difference === 0;
}

export async function POST(request: Request) {
  const isLoopback = new URL(request.url).hostname === "127.0.0.1";
  const authorized = isLoopback ? authorizedLocalArchive(request) : await authorizedArchive(request);
  if (!authorized) return Response.json({ error: "Acesso negado" }, { status: 401 });
  try {
    const result = await archiveWeather();
    return Response.json(result, { status: result.incomplete ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Falha na coleta agendada", error);
    return Response.json({ error: "Falha na coleta agendada" }, { status: 503 });
  }
}
