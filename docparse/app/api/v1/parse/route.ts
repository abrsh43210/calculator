import { handleParse } from "@/lib/server/handlers";
import { getServices } from "@/lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Haiku plus a possible Sonnet retry on a multi-page PDF; > 60s needs Vercel Fluid compute / Pro.
export const maxDuration = 120;

export async function POST(req: Request): Promise<Response> {
  return handleParse(req, getServices());
}
