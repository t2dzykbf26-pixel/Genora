import { generateAgnesImage, isAgnesConfigured } from "@/lib/agnes";
import { db } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/error-codes";
import { generateHidreamImage, isHidreamConfigured, isHidreamModel } from "@/lib/hidream";
import { generateIdeogramImage, isIdeogramModel } from "@/lib/ideogram";
import { saveBuffer } from "@/lib/storage";
import { errorMessage, publicTask } from "@/lib/tasks";

const DEFAULT_MODEL = "agnes-image-2.1-flash";

function parseSize(size: string) {
  const [width, height] = size.split("x").map((value) => Number(value));
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1024,
    height: Number.isFinite(height) && height > 0 ? height : 1024,
  };
}

export async function POST(request: Request) {
  const body = await request.json();
  const prompt = String(body.prompt ?? "").trim();
  const size = String(body.size ?? "1024x1024");
  const model = String(body.model ?? DEFAULT_MODEL);
  const seed = Number(body.seed ?? 0);
  if (!prompt) return errorResponse(new AppError("EMPTY_IMAGE_PROMPT", 400), 400);
  if (isHidreamModel(model) && !isHidreamConfigured()) {
    return errorResponse(new AppError("HIDREAM_MISSING_MODEL_PATH", 503), 503);
  }
  if (model === DEFAULT_MODEL && !isAgnesConfigured("image")) {
    return errorResponse(new AppError("MISSING_AGNES_API_KEY", 503), 503);
  }

  const task = await db.task.create({
    data: {
      type: "image",
      status: "processing",
      prompt,
      params: JSON.stringify({ size, model, seed }),
    },
  });

  try {
    const image = isHidreamModel(model)
      ? await generateHidreamImage({ prompt, model, seed, ...parseSize(size) })
      : isIdeogramModel(model)
      ? await generateIdeogramImage({ prompt, model, seed, ...parseSize(size) })
      : await generateAgnesImage(prompt);
    const outputPath = await saveBuffer("images", `${task.id}.png`, image);
    return Response.json(publicTask(await db.task.update({ where: { id: task.id }, data: { status: "completed", outputPath } })));
  } catch (error) {
    const code = errorMessage(error);
    await db.task.update({ where: { id: task.id }, data: { status: "failed", error: code } });
    return errorResponse(error, 502);
  }
}