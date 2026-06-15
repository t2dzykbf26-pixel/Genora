import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { AppError } from "@/lib/error-codes";

export type HiDreamModel = "hidream-o1-dev" | "hidream-o1-full";

function pythonCommand() {
  return (process.env.HIDREAM_PYTHON?.trim() || "python").replace(/^["']|["']$/g, "");
}

function hidreamDir() {
  return path.join(process.cwd(), "vendor", "hidream");
}

function modelPath() {
  return process.env.HIDREAM_MODEL_PATH?.trim() || "";
}

function modelType() {
  const raw = process.env.HIDREAM_MODEL_TYPE?.trim()?.toLowerCase();
  return raw === "full" ? "full" : "dev";
}

function compactProcessOutput(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 700);
}

export function isHidreamModel(value: string): value is HiDreamModel {
  return value === "hidream-o1-dev" || value === "hidream-o1-full";
}

export function isHidreamConfigured() {
  const mp = modelPath();
  return !!mp;
}

async function hasCuda() {
  const result = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(pythonCommand(), ["-c", "import torch; print('1' if torch.cuda.is_available() else '0')"], {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve({ code: 1, stdout: "" }));
    child.on("close", (code) => resolve({ code, stdout }));
  });
  return result.code === 0 && result.stdout.trim() === "1";
}

export async function generateHidreamImage(options: {
  prompt: string;
  model: HiDreamModel;
  width: number;
  height: number;
  seed?: number;
}) {
  if (!modelPath()) {
    throw new AppError("HIDREAM_MISSING_MODEL_PATH", 503);
  }
  if (!(await hasCuda())) {
    throw new AppError("HIDREAM_CUDA_REQUIRED", 503);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "genora-hidream-"));
  const output = path.join(tempDir, "output.png");
  const typeFlag = options.model === "hidream-o1-full" ? "full" : modelType();
  const args = [
    "run_inference.py",
    "--prompt",
    options.prompt,
    "--output",
    output,
    "--width",
    String(options.width),
    "--height",
    String(options.height),
    "--model_path",
    modelPath(),
    "--model_type",
    typeFlag,
    "--seed",
    String(Number.isFinite(options.seed) ? options.seed : 32),
  ];

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(pythonCommand(), args, {
      cwd: hidreamDir(),
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(new AppError("HIDREAM_NOT_INSTALLED", 503, error.message));
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

  if (result.code !== 0) {
    const detail = compactProcessOutput(result.stderr);
    if (/ModuleNotFoundError|No module named|ImportError/i.test(detail)) {
      throw new AppError("HIDREAM_NOT_INSTALLED", 503, detail);
    }
    if (/CUDA|cuda/i.test(detail) && /unavailable|not available/i.test(detail)) {
      throw new AppError("HIDREAM_CUDA_REQUIRED", 503, detail);
    }
    throw new AppError("HIDREAM_INFERENCE_FAILED", 502, detail);
  }

  return readFile(output);
}
