import { NextResponse } from "next/server";
import mammoth from "mammoth";

/**
 * Extracts plain text from an uploaded .docx transcript so the browser
 * can drop it straight into the transcript textarea. .txt files are read
 * client-side directly and never hit this route. No content is persisted
 * server-side beyond this single request/response.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json({ error: "Only .docx uploads are supported by this endpoint" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { value } = await mammoth.extractRawText({ buffer });
    return NextResponse.json({ text: value });
  } catch (error) {
    return NextResponse.json(
      { error: "Text extraction failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
