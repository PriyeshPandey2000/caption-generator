import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const apiKey = formData.get("apiKey") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: "Groq API key required" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const blob = new Blob([bytes], { type: file.type });

    const groqFormData = new FormData();
    groqFormData.append("file", blob, file.name);
    groqFormData.append("model", "whisper-large-v3-turbo");
    groqFormData.append("response_format", "verbose_json");
    groqFormData.append("timestamp_granularities[]", "word");
    groqFormData.append("timestamp_granularities[]", "segment");
    groqFormData.append("language", "en");

    const response = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: groqFormData,
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json(
        { error: `Groq API error: ${err}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: `Transcription failed: ${error}` },
      { status: 500 }
    );
  }
}
