import type { Task } from "@prisma/client";

function safeJsonParse(text: string): Record<string, unknown> {
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}
import { generateAgnesImage } from "@/lib/agnes";
import { db } from "@/lib/db";
import { generateHidreamImage, isHidreamModel } from "@/lib/hidream";
import { generateIdeogramImage, isIdeogramModel } from "@/lib/ideogram";
import { saveBuffer } from "@/lib/storage";
import { errorMessage } from "@/lib/tasks";
import { isActiveTaskStatus } from "@/lib/task-status";

type ImageTaskParams = {
  size?: string;
  model?: string;
  seed?: number;
};

const activeImageTasks = new Map<string, Promise<Task | null>>();

function parseSize(size = "1024x1024") {
  const [width, height] = size.split("x").map((value) => Number(value));
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1024,
    height: Number.isFinite(height) && height > 0 ? height : 1024,
  };
}

async function executeImageTask(taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.type !== "image" || !isActiveTaskStatus(task.status)) return task;

  await db.task.update({ where: { id: task.id }, data: { status: "processing", error: null } });
  const params = safeJsonParse(task.params) as ImageTaskParams;
  const model = params.model ?? "agnes-image-2.1-flash";

  try {
    const image = isHidreamModel(model)
      ? await generateHidreamImage({
          prompt: task.prompt,
          model,
          seed: Number(params.seed ?? 0),
          ...parseSize(params.size),
        })
      : isIdeogramModel(model)
      ? await generateIdeogramImage({
          prompt: task.prompt,
          model,
          seed: Number(params.seed ?? 0),
          ...parseSize(params.size),
        })
      : await generateAgnesImage(task.prompt);

    const current = await db.task.findUnique({ where: { id: task.id } });
    if (!current || current.status === "cancelled") return current;

    const outputPath = await saveBuffer("images", `${task.id}.png`, image);
    const afterSave = await db.task.findUnique({ where: { id: task.id } });
    if (!afterSave || afterSave.status === "cancelled") return afterSave;

    return db.task.update({
      where: { id: task.id },
      data: { status: "completed", outputPath, error: null },
    });
  } catch (error) {
    const current = await db.task.findUnique({ where: { id: task.id } });
    if (!current || current.status === "cancelled") return current;
    return db.task.update({
      where: { id: task.id },
      data: { status: "failed", error: errorMessage(error) },
    });
  }
}

export function startImageTask(taskId: string) {
  const active = activeImageTasks.get(taskId);
  if (active) return active;
  const execution = executeImageTask(taskId).finally(() => activeImageTasks.delete(taskId));
  activeImageTasks.set(taskId, execution);
  return execution;
}

export function scheduleImageTask(taskId: string) {
  queueMicrotask(() => void startImageTask(taskId));
}
