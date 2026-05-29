import Together from "together-ai";
import { NextRequest, NextResponse } from "next/server";

const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();

    if (!prompt) {
      return NextResponse.json({ error: "No prompt provided" }, { status: 400 });
    }

    // Start video generation
    const inferenceResponse = await together.videos.create({
      model: "google/veo-3.1-lite",
      prompt: prompt,
      width: 720,
      height: 1280,
      seconds: 4,
      fps: 15,
      output_format: "MP4"
    });

    return NextResponse.json({ 
      id: inferenceResponse.id,
      status: "pending"
    });
  } catch (error) {
    console.error("[v0] TogetherAI Video API error:", error);
    return NextResponse.json(
      { error: "Failed to start video generation" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get("id");

    if (!videoId) {
      return NextResponse.json({ error: "No video ID provided" }, { status: 400 });
    }

    // Poll for video completion
    const videoResponse = await together.videos.retrieve(videoId);

    return NextResponse.json({
      id: videoResponse.id,
      status: videoResponse.status,
      output: videoResponse.output
    });
  } catch (error) {
    console.error("[v0] TogetherAI Video retrieve error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve video" },
      { status: 500 }
    );
  }
}
