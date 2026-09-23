import { authorizedArchive } from "@/lib/github-archive-auth";
import { archiveWeather } from "../route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!await authorizedArchive(request)) return Response.json({ error: "Acesso negado" }, { status: 401 });
  try {
    const result = await archiveWeather();
    return Response.json(result, { status: result.incomplete ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Falha na coleta agendada", error);
    return Response.json({ error: "Falha na coleta agendada" }, { status: 503 });
  }
}
