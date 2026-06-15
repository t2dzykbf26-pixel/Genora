export const ERROR_MESSAGES_ZH = {
  UNKNOWN_ERROR: "发生未知错误，请稍后重试",
  INVALID_JSON_RESPONSE: "服务返回了非 JSON 内容，已阻止乱码直接显示",
  MISSING_OPENAI_API_KEY: "尚未配置 OPENAI_API_KEY，请在 .env 中填写后重启服务",
  MISSING_AGNES_API_KEY: "尚未配置 Agnes API Key，请在 .env 中配置后重启服务",
  EMPTY_TEXT_PROMPT: "请输入文本提示词",
  EMPTY_IMAGE_PROMPT: "请输入图片提示词",
  EMPTY_VIDEO_PROMPT: "请输入视频提示词",
  EMPTY_AGENT_PROMPT: "请输入 Agent 提示词",
  UNSUPPORTED_AGENT_MODEL: "不支持的 Agent 模型",
  INVALID_IMAGE_FORMAT: "图片仅支持 PNG、JPEG 或 WebP 格式",
  IMAGE_UPLOAD_TOO_LARGE: "上传图片不能超过 10 MB",
  IMAGE_TASK_NOT_FOUND: "找不到所选图片",
  INTERRUPTED_BY_USER: "任务已被用户打断",
  TASK_POLL_TIMEOUT: "任务状态查询超时，请稍后重新查询",
  TASK_NOT_FOUND: "任务不存在",
  AGNES_LOCAL_IMAGE_UNSUPPORTED: "Agnes 暂时无法读取本地图片数据，请先接入公网对象存储后再使用",
  AGNES_RATE_LIMIT: "Agnes 当前上游负载较高，请稍后重试",
  AGNES_SERVICE_BUSY: "Agnes 视频队列被远端任务占用，暂无法提交新任务。请等待或更换 API Key 后重试",
  AGNES_REQUEST_TIMEOUT: "Agnes 接口超时未响应，远端队列可能繁忙或任务排队中",
  AGNES_OUT_OF_MEMORY: "Agnes 上游显存不足，请降低分辨率或稍后再试",
  AGNES_CLOUDFLARE_520: "Agnes 上游网关异常 (520)，通常是远端服务临时故障，非本地参数错误",
  AGNES_UPSTREAM_ERROR: "Agnes 上游服务请求失败，系统已自动重试，如持续失败请降低画质或更换提示词",
  AGNES_NO_DEPLOYMENT: "当前 Agnes 模型暂无可用部署，请检查模型名称或等待上游恢复",
  AGNES_EMPTY_TEXT: "Agnes 文本模型没有返回内容",
  AGNES_EMPTY_IMAGE: "Agnes 图片模型没有返回图片数据",
  AGNES_MISSING_TASK_ID: "Agnes API 没有返回任务 ID",
  AGNES_VIDEO_FAILED: "Agnes 视频生成失败",
  AGNES_VIDEO_MISSING_URL: "Agnes 任务已完成但未返回视频地址",
  AGNES_VIDEO_TIMEOUT: "视频生成等待超时，任务仍在远端处理中，可稍后继续查询",
  IDEOGRAM_MISSING_HF_TOKEN: "尚未配置 HF_TOKEN，无法下载 Ideogram 4 模型权重",
  IDEOGRAM_MODEL_ACCESS_DENIED: "无法访问 Ideogram 4 模型。请先在 Hugging Face 接受模型协议",
  IDEOGRAM_NOT_INSTALLED: "Ideogram 4 本地 Python 环境未安装，请先在 vendor/ideogram4 中执行 pip install -e .",
  IDEOGRAM_NF4_REQUIRES_CUDA: "Ideogram 4 nf4 需要 CUDA 显卡，当前为 CPU 环境，请改用 fp8 或切换环境",
  IDEOGRAM_INFERENCE_FAILED: "Ideogram 4 本地推理失败，请检查 Python 环境、显存和模型权限",
  IDEOGRAM_IMG2IMG_UNSUPPORTED: "Ideogram 4 目前仅支持文生图，暂不支持图生图",
  HIDREAM_MISSING_MODEL_PATH: "尚未配置 HIDREAM_MODEL_PATH，请在 .env 中指定模型路径",
  HIDREAM_NOT_INSTALLED: "HiDream 推理环境未安装，请先在 vendor/hidream 中执行 pip install -r requirements.txt",
  HIDREAM_CUDA_REQUIRED: "HiDream 需要 CUDA 显卡，请确认 GPU 环境",
  HIDREAM_INFERENCE_FAILED: "HiDream 推理失败，请检查模型路径、显存和 Python 环境",
  DOWNLOAD_FAILED: "下载生成结果失败，请稍后重试",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES_ZH;

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  detail?: string;

  constructor(code: ErrorCode, status = 500, detail?: string) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && value in ERROR_MESSAGES_ZH;
}

export function errorCodeFromUnknown(error: unknown): ErrorCode {
  if (error instanceof AppError) return error.code;
  if (error && typeof error === "object" && "code" in error && isErrorCode((error as { code?: unknown }).code)) {
    return (error as { code: ErrorCode }).code;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (isErrorCode(message)) return message;
  if (/cuda out of memory|out of memory/i.test(message)) return "AGNES_OUT_OF_MEMORY";
  if (/no deployments available|deployment/i.test(message)) return "AGNES_NO_DEPLOYMENT";
  if (/429|rate|too many/i.test(message)) return "AGNES_RATE_LIMIT";
  if (/520|cloudflare|web server is returning an unknown error/i.test(message)) return "AGNES_CLOUDFLARE_520";
  if (/do_request_failed|upstream error|500|502|503|504/i.test(message)) return "AGNES_UPSTREAM_ERROR";
  if (/GatedRepoError|not authorized|restricted/i.test(message)) return "IDEOGRAM_MODEL_ACCESS_DENIED";
  if (/ModuleNotFoundError|No module named|ImportError/i.test(message)) return "IDEOGRAM_NOT_INSTALLED";
  if (/CUDA|bitsandbytes|nf4/i.test(message)) return "IDEOGRAM_NF4_REQUIRES_CUDA";
  if (/ENOENT|spawn|python/i.test(message)) return "IDEOGRAM_NOT_INSTALLED";
  if (/HIDREAM_MISSING_MODEL_PATH|HIDREAM_MODEL_PATH/i.test(message)) return "HIDREAM_MISSING_MODEL_PATH";
  if (/HIDREAM_NOT_INSTALLED/i.test(message)) return "HIDREAM_NOT_INSTALLED";
  if (/HIDREAM_CUDA_REQUIRED/i.test(message)) return "HIDREAM_CUDA_REQUIRED";
  if (/HIDREAM_INFERENCE_FAILED/i.test(message)) return "HIDREAM_INFERENCE_FAILED";
  if (/download/i.test(message)) return "DOWNLOAD_FAILED";

  return "UNKNOWN_ERROR";
}

export function errorDetail(error: unknown) {
  if (error instanceof AppError) return error.detail;
  if (error && typeof error === "object" && "detail" in error) {
    return String((error as { detail?: unknown }).detail ?? "").slice(0, 500);
  }
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error ?? "").slice(0, 500);
}

export function errorResponse(error: unknown, fallbackStatus = 502) {
  const code = errorCodeFromUnknown(error);
  const status = error instanceof AppError ? error.status : fallbackStatus;
  return Response.json({ error: code, errorCode: code, detail: errorDetail(error) }, { status });
}
