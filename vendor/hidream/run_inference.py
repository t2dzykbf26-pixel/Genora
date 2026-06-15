"""Minimal text-to-image inference wrapper for HiDream-O1-Image."""

from __future__ import annotations

import argparse
import os
import sys

import torch


def main() -> None:
    parser = argparse.ArgumentParser("HiDream-O1-Image text-to-image inference")
    parser.add_argument("--prompt", required=True, help="Text prompt for generation")
    parser.add_argument("--output", default="output.png", help="Output image path")
    parser.add_argument("--width", type=int, default=512, help="Output width (default: 512)")
    parser.add_argument("--height", type=int, default=512, help="Output height (default: 512)")
    parser.add_argument("--model_path", required=True, help="Path to HiDream model directory")
    parser.add_argument("--model_type", default="dev", choices=["full", "dev"], help="Model type: full (50 steps) or dev (28 steps)")
    parser.add_argument("--seed", type=int, default=32, help="Random seed")
    args = parser.parse_args()

    if not torch.cuda.is_available():
        print("ERROR: CUDA is required for HiDream inference.", file=sys.stderr)
        sys.exit(1)

    print(f"[hidream] Loading model from {args.model_path} (type={args.model_type})", file=sys.stderr)

    try:
        from transformers import AutoProcessor
        from models.qwen3_vl_transformers import Qwen3VLForConditionalGeneration
        from models.pipeline import generate_image, DEFAULT_TIMESTEPS
    except ImportError as e:
        print(f"ERROR: Missing dependencies. Please install requirements: {e}", file=sys.stderr)
        sys.exit(1)

    processor = AutoProcessor.from_pretrained(args.model_path)
    model = Qwen3VLForConditionalGeneration.from_pretrained(
        args.model_path, torch_dtype=torch.bfloat16, device_map="cuda"
    ).eval()

    tokenizer = processor.tokenizer if hasattr(processor, "tokenizer") else processor
    tokenizer.boi_token = "<|boi_token|>"
    tokenizer.bor_token = "<|bor_token|>"
    tokenizer.eor_token = "<|eor_token|>"
    tokenizer.bot_token = "<|bot_token|>"
    tokenizer.tms_token = "<|tms_token|>"

    if args.model_type == "full":
        num_inference_steps = 50
        guidance_scale = 5.0
        shift = 3.0
        timesteps_list = None
        scheduler_name = "default"
    else:
        num_inference_steps = 28
        guidance_scale = 0.0
        shift = 1.0
        timesteps_list = DEFAULT_TIMESTEPS
        scheduler_name = "flash"

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    print(f"[hidream] Generating {args.width}x{args.height} image ({num_inference_steps} steps)...", file=sys.stderr)

    image = generate_image(
        model=model,
        processor=processor,
        prompt=args.prompt,
        ref_image_paths=[],
        height=args.height,
        width=args.width,
        num_inference_steps=num_inference_steps,
        guidance_scale=guidance_scale,
        shift=shift,
        timesteps_list=timesteps_list,
        scheduler_name=scheduler_name,
        seed=args.seed,
    )

    image.save(args.output)
    print(f"OK:{args.output}")


if __name__ == "__main__":
    main()
