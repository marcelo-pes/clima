import { requireChatGPTUser } from "@/app/chatgpt-auth";
import GenerationDashboard from "./generation-dashboard";

export const dynamic = "force-dynamic";

export default async function GenerationPage() {
  const user = await requireChatGPTUser("/geracao");
  return <GenerationDashboard userName={user.displayName} />;
}
