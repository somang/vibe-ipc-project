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
      model: "meta-llama/Llama-Vision-Free",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this image in 5-10 evocative, poetic single words or short phrases. Return ONLY a JSON array of strings, no other text. Example: [\"flowing\", \"ethereal light\", \"movement\", \"blue depths\", \"calm\"]",
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

    return NextResponse.json({ words });
  } catch (error) {
    console.error("TogetherAI API error:", error);
    return NextResponse.json(
      { error: "Failed to analyze image" },
      { status: 500 }
    );
  }
}
