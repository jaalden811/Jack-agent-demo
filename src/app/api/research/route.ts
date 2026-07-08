import { NextResponse } from "next/server";
import { runResearch } from "@/lib/services";
import { saveRun } from "@/lib/storage";
import { researchInputSchema } from "@/lib/types";

// Read env vars at request time, not build time.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const input = researchInputSchema.parse({
      ciscoProduct: formData.get("ciscoProduct"),
      targetMarket: formData.get("targetMarket"),
      geography: formData.get("geography") ?? "",
      companySize: formData.get("companySize") ?? "",
      maxResults: formData.get("maxResults") ?? "5",
      seedAccounts: formData.get("seedAccounts") ?? ""
    });

    const files = formData
      .getAll("knowledgeBase")
      .filter((file): file is File => file instanceof File && file.size > 0);

    const run = await runResearch(input, files);
    await saveRun(run);
    return NextResponse.json(run);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Research run failed",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
