import { handleGetUsage } from "@/lib/server/handlers";
import { getServices } from "@/lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return handleGetUsage(req, getServices());
}
