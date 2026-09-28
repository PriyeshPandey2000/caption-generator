import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

// Authorizes the browser's direct-to-Blob upload (see upload() in Editor.tsx)
// and issues the short-lived client token it needs. This has to be a server
// route — a client token that anyone could mint themselves would let anyone
// write arbitrary files to the store — even though the token it hands out
// is itself unauthenticated (no login on this app), so this only pins down
// *what* can be uploaded (size/type), not *who*.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["video/*", "audio/*"],
        addRandomSuffix: true,
        // A generous ceiling against abuse/runaway storage costs, not a real
        // limit videos should hit in practice — Groq's own Whisper API size
        // limit is far smaller than this.
        maximumSizeInBytes: 500 * 1024 * 1024,
      }),
      // No DB record to update: /api/transcribe fetches the blob by URL
      // directly (the client passes it straight through) and deletes it once
      // transcription finishes, so there's nothing to persist here.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload authorization failed" },
      { status: 400 }
    );
  }
}
