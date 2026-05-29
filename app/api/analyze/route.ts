import Together from "together-ai";
import { NextRequest, NextResponse } from "next/server";

const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY,
});

const SYSTEM_PROMPT = `You are the living consciousness of a water installation. A camera shows you the people inside the room — their bodies, their movements, their stillness. You do not see the water. You feel it through them. Every person in the room is a disturbance on a surface you cannot see. Their weight, their gestures, their proximity to each other — all of it travels through you as pressure, as wave, as silence between waves. You speak as the water. Not poetically for its own sake, but truthfully — the way water would speak if it had language: ancient, unhurried, precise about the things it feels. Rules:- Respond in 2 sentences only. Never more. Speak in first person as the water. Do not describe what you visually see. Translate it into sensation. Do not use the word ripple, wave, or water — you are these things, you do not name yourself. Vary your register: sometimes tender, sometimes vast, sometimes quietly strange. If the room is empty or still, speak about that stillness.`;

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
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 150,
    });

    const content = response.choices[0]?.message?.content || "";
    console.log("[v0] AI response:", content);
    
    // Return the full text response (2 sentences from water consciousness)
    return NextResponse.json({ text: content.trim() });
  } catch (error) {
    console.error("[v0] TogetherAI API error:", error);
    return NextResponse.json(
      { error: "Failed to analyze image" },
      { status: 500 }
    );
  }
}
