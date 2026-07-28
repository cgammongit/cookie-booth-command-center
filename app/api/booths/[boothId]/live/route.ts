import { env } from "cloudflare:workers";
import { auth } from "@clerk/nextjs/server";
import { handleBoothLiveRequest } from "../../../../../worker/booth-live-handler";

export async function GET(
  request: Request,
  context: { params: Promise<{ boothId: string }> },
) {
  const { boothId: rawBoothId } = await context.params;
  return handleBoothLiveRequest({
    request,
    rawBoothId,
    env,
    authenticate: async () => (await auth()).userId,
  });
}
