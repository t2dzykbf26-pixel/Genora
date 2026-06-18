import { get } from "node:https";
import { describeAgnesVideoState } from "@/lib/agnes-status";
import { AppError } from "@/lib/error-codes";
import { saveBuffer } from "@/lib/storage";

const API_BASE = "https://apihub.agnes-ai.com/v1";
const SUCCESS = new Set(["completed", "complete", "succeeded", "success", "done"]);
const FAILURE = new Set(["failed", "error", "cancelled", "canceled"]);
const RETRYABLE_STATUS = new Set([429, 500, 520, 522, 524, 503]);
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = Number(process.env.AGNES_REQUEST_TIMEOUT_MS ?? 180_000);
const VIDEO_CREATE_TIMEOUT_MS = Number(process.env.AGNES_VIDEO_CREATE_TIMEOUT_MS ?? 300_000);

type AgnesService = "image" | "text" | "video";

function apiKey(service: AgnesService) {
  const keyMap: Record<AgnesService, string | undefined> = {
    image: process.env.AGNES_IMAGE_2_1_FLASH_API_KEY,
    text: process.env.AGNES_1_5_FLASH_API_KEY,
    video: process.env.AGNES_VIDEO_V2_0_API_KEY,
  };
  const raw = keyMap[service]?.trim();
  if (!raw) {
    const envNames: Record<AgnesService, string> = {
      image: "AGNES_IMAGE_2_1_FLASH_API_KEY",
      text: "AGNES_1_5_FLASH_API_KEY",
      video: "AGNES_VIDEO_V2_0_API_KEY",
    };
    throw new AppError("MISSING_AGNES_API_KEY", 503, `缺少 ${envNames[service]}，请在 .env 中配置后重启`);
  }
  return raw;
}

async function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function stripHtml(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function agnesErrorCode(status: number, text: string) {
  if (status === 429) return "AGNES_RATE_LIMIT";
  if (/service busy|tasks:\s*\d+/i.test(text)) return "AGNES_SERVICE_BUSY";
  if (status === 520) return "AGNES_CLOUDFLARE_520";
  if (/cuda out of memory|out of memory/i.test(text)) return "AGNES_OUT_OF_MEMORY";
  if (/no deployments available|deployment/i.test(text)) return "AGNES_NO_DEPLOYMENT";
  if (/do_request_failed|upstream error/i.test(text)) return "AGNES_UPSTREAM_ERROR";
  return "AGNES_UPSTREAM_ERROR";
}

async function parseJson(text: string) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("INVALID_JSON_RESPONSE", 502, stripHtml(text).slice(0, 500));
  }
}

async function downloadBuffer(url: string) {
  try {
    const response = await fetch(url);
    if (response.ok) return Buffer.from(await response.arrayBuffer());
  } catch { /* fall through to Node https */ }

  return new Promise<Buffer>((resolve, reject) => {
    get(url, (response) => {
      if ((response.statusCode ?? 500) >= 400) {
        reject(new AppError("DOWNLOAD_FAILED", 502, `下载失败 (HTTP ${response.statusCode})`));
        response.resume();
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    }).on("error", reject);
  });
}


function videoLog(section: string, detail: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const parts = Object.entries(detail).map(([k, v]) => {
    const val = String(v ?? "");
    if (val.length > 300) return k + "=" + val.slice(0, 300) + "...(trimmed)";
    return k + "=" + val;
  }).join(" ");
  console.log("[" + ts + "] [agnes-video] " + section + " " + parts);
}

async function request(url: string, service: AgnesService, init?: RequestInit) {
  const key = apiKey(service);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    videoLog("request-start", { attempt: String(attempt), method: init?.method ?? "GET", url, service });
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(Number.isFinite(REQUEST_TIMEOUT_MS) ? REQUEST_TIMEOUT_MS : 45_000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || /timeout/i.test(error.message))) {
        videoLog("request-timeout", { attempt: String(attempt), error: error.message });
        throw new AppError("AGNES_REQUEST_TIMEOUT", 504, "Agnes 接口超时未响应，远端队列可能繁忙");
      }
      throw error;
    }
    const text = await response.text();
    if (response.ok) {
      videoLog("request-ok", { attempt: String(attempt), status: String(response.status), bodyLen: String(text.length), bodyPreview: text.slice(0, 300) });
      return parseJson(text);
    }

    if (text.includes("data:") || text.includes("image_url")) {
      throw new AppError("AGNES_LOCAL_IMAGE_UNSUPPORTED", 502, stripHtml(text).slice(0, 500));
    }

    videoLog("request-retryable", { attempt: String(attempt), status: String(response.status), bodyPreview: text.slice(0, 200) });
    if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_RETRIES) {
      const detail = stripHtml(text).slice(0, 500);
      videoLog("request-error-final", { attempt: String(attempt), status: String(response.status), errorBody: text.slice(0, 500), errorCode: agnesErrorCode(response.status, text) });
      throw new AppError(agnesErrorCode(response.status, text), response.status, detail);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1200 * 2 ** attempt);
  }

  throw new AppError("AGNES_UPSTREAM_ERROR", 502, "Agnes 上游多次重试后仍失败");
}

export async function generateAgnesText(prompt: string) {
  return generateAgnesMessages([{ role: "user", content: prompt }]);
}

export async function generateAgnesMessages(messages: unknown[]) {
  const result = await request(`${API_BASE}/chat/completions`, "text", {
    method: "POST",
    body: JSON.stringify({ model: "agnes-2.0-flash", messages }),
  });
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new AppError("AGNES_EMPTY_TEXT", 502, JSON.stringify(result).slice(0, 300));
  return String(content);
}

export async function generateAgnesImage(prompt: string) {
  const result = await request(`${API_BASE}/images/generations`, "image", {
    method: "POST",
    body: JSON.stringify({ model: "agnes-image-2.1-flash", prompt }),
  });
  const image = result.data?.[0];
  if (image?.b64_json) return Buffer.from(String(image.b64_json), "base64");
  if (image?.url) return downloadBuffer(String(image.url));
  throw new AppError("AGNES_EMPTY_IMAGE", 502, JSON.stringify(result).slice(0, 300));
}

function findValue(value: unknown, keys: Set<string>): unknown {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findValue(child, keys);
      if (found !== undefined && found !== null && found !== "") return found;
    }
  } else if (value && typeof value === "object") {
    for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(name.toLowerCase()) && child !== undefined && child !== null && child !== "") return child;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      const found = findValue(child, keys);
      if (found !== undefined && found !== null && found !== "") return found;
    }
  }
}

export async function createAgnesVideo(payload: Record<string, unknown>) {
  const payloadJson = JSON.stringify(payload);
  videoLog("create-video", { model: String(payload.model ?? ""), width: String(payload.width ?? ""), height: String(payload.height ?? ""), frames: String(payload.num_frames ?? ""), payloadBytes: String(payloadJson.length), hasImage: String(payload.image ? "true" : "false") });
  const timeoutMs = Number.isFinite(VIDEO_CREATE_TIMEOUT_MS) && VIDEO_CREATE_TIMEOUT_MS > 0 ? VIDEO_CREATE_TIMEOUT_MS : 300_000;
  const result = await request(`${API_BASE}/videos`, "video", {
    method: "POST",
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const id = findValue(result, new Set(["task_id", "id"]));
  videoLog("create-video-result", { taskId: String(id ?? "MISSING"), responsePreview: JSON.stringify(result).slice(0, 300) });
  if (!id) throw new AppError("AGNES_MISSING_TASK_ID", 502, JSON.stringify(result).slice(0, 300));
  return String(id);
}

export async function syncAgnesVideo(remoteTaskId: string, localTaskId: string) {
  videoLog("sync-video-start", { remoteTaskId, localTaskId });
  const result = await request(`${API_BASE}/videos/${remoteTaskId}`, "video");
  const state = describeAgnesVideoState(result);
  const status = state.remoteStatus;
  videoLog("sync-video-status", {
    remoteTaskId,
    remoteStatus: status,
    progress: String(state.progress ?? ""),
    queuedSeconds: String(state.queuedSeconds ?? ""),
    queueWarning: String(state.queueWarning),
    responsePreview: JSON.stringify(result).slice(0, 300),
  });
  if (FAILURE.has(status)) {
    return { status: "failed", error: "AGNES_VIDEO_FAILED", lastRemoteStatus: status };
  }

  const videoUrl = findValue(result, new Set(["video_url", "output_url", "download_url", "url", "remixed_from_video_id", "result_url"]));
  if (SUCCESS.has(status) || (typeof videoUrl === "string" && videoUrl.startsWith("http"))) {
    if (typeof videoUrl !== "string" || !videoUrl.startsWith("http")) {
      throw new AppError("AGNES_VIDEO_MISSING_URL", 502, JSON.stringify(result).slice(0, 300));
    }
    const outputPath = await saveBuffer("videos", `${localTaskId}.mp4`, await downloadBuffer(videoUrl));
    return { status: "completed", outputPath, lastRemoteStatus: status };
  }

  // Map remote non-terminal status to local status
  if (status === "queued" || status === "pending") {
    return { status: "queued", lastRemoteStatus: status };
  }
  return { status: "processing", lastRemoteStatus: status };
}

// ----- 公开辅助：检查配置 -----
export function isAgnesConfigured(service?: AgnesService) {
  if (service) {
    try { apiKey(service); return true; } catch { return false; }
  }
  try { apiKey("image"); return true; } catch { /* empty */ }
  try { apiKey("text"); return true; } catch { /* empty */ }
  try { apiKey("video"); return true; } catch { /* empty */ }
  return false;
}
