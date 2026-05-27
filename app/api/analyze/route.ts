import Together from "together-ai";
import { NextRequest, NextResponse } from "next/server";

const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { imageBase64 } = await request.json();

    if (!imageBase64) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const response = await together.chat.completions.create({
      model: "google/gemma-3n-e4b-it",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "What do you see here? Show only Five keywords in a JSON format without any words.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 200,
    });

    const content = response.choices[0]?.message?.content || "[]";
    console.log("[v0] AI response:", content);
    
    // Try to parse JSON from the response
    let words: string[] = [];
    try {
      // Find JSON array in the response
      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        words = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // If parsing fails, split by commas or newlines
      words = content
        .replace(/[\[\]"]/g, "")
        .split(/[,\n]/)
        .map((w: string) => w.trim())
        .filter((w: string) => w.length > 0);
    }

    console.log("[v0] Parsed words:", words);
    return NextResponse.json({ words });
  } catch (error) {
    console.error("[v0] TogetherAI API error:", error);
    return NextResponse.json(
      { error: "Failed to analyze image" },
      { status: 500 }
    );
  }
}
