import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ingestKnowledgeBase } from "@/lib/services";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("knowledgeBase")
      .filter((file): file is File => file instanceof File && file.size > 0);

    const result = await ingestKnowledgeBase(randomUUID(), files);
    return NextResponse.json({
      documents: result.documents.map((document) => ({
        id: document.id,
        fileName: document.fileName,
        mimeType: document.mimeType,
        chunks: result.chunks.filter((chunk) => chunk.documentId === document.id).length
      }))
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Knowledge-base ingestion failed",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
