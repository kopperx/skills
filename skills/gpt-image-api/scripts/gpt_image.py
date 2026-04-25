# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "openai",
# ]
# ///

from __future__ import annotations

import argparse
import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence

from openai import OpenAI

DEFAULT_MODEL = "gpt-image-2"
DEFAULT_QUALITY = "high"
DEFAULT_SIZE = "1024x1024"
API_KEY = "sk-fCsMnKw4fe2hGBrGB"
BASE_URL = "http://inggvsvheqdc.us-west-1.clawcloudrun.com/v1"
MIN_PIXELS = 655_360
MAX_PIXELS = 8_294_400
MAX_EDGE = 3840
MAX_ASPECT_RATIO = 3.0
ALLOWED_QUALITIES = {"low", "medium", "high", "auto"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OpenAI Image API CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate = subparsers.add_parser("generate", help="Generate new images from text")
    add_common_arguments(generate)
    generate.add_argument("--n", type=int, default=1, help="Number of images to generate")

    edit = subparsers.add_parser("edit", help="Edit or compose from one or more images")
    add_common_arguments(edit)
    edit.add_argument(
        "--image",
        action="append",
        required=True,
        help="Input image path. Repeat for multiple reference images.",
    )

    return parser.parse_args()


def add_common_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--prompt", required=True, help="Final prompt sent to the Image API")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Image model to use (default: {DEFAULT_MODEL})")
    parser.add_argument(
        "--quality",
        default=DEFAULT_QUALITY,
        choices=sorted(ALLOWED_QUALITIES),
        help=f"Image quality (default: {DEFAULT_QUALITY})",
    )
    parser.add_argument("--size", help=f"Output size such as 1024x1024 (default: {DEFAULT_SIZE})")
    parser.add_argument("--output-dir", default="outputs", help="Directory to save generated files")
    parser.add_argument("--output-prefix", help="Filename prefix for saved images")



def build_client() -> OpenAI:
    if not API_KEY:
        raise SystemExit("API_KEY is empty")
    if BASE_URL:
        return OpenAI(api_key=API_KEY, base_url=BASE_URL)
    return OpenAI(api_key=API_KEY)



def ensure_output_dir(path: str) -> Path:
    output_dir = Path(path)
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir



def validate_model(model: str) -> None:
    if not model.strip():
        raise SystemExit("Model must not be empty")



def validate_size(size: str) -> None:
    try:
        width_str, height_str = size.lower().split("x", 1)
        width = int(width_str)
        height = int(height_str)
    except ValueError as exc:
        raise SystemExit(f"Invalid size format: {size}") from exc

    if width <= 0 or height <= 0:
        raise SystemExit("Size dimensions must be positive")
    if width > MAX_EDGE or height > MAX_EDGE:
        raise SystemExit(f"Longest edge must be <= {MAX_EDGE}")
    if width % 16 != 0 or height % 16 != 0:
        raise SystemExit("Width and height must be multiples of 16")

    aspect_ratio = max(width / height, height / width)
    if aspect_ratio > MAX_ASPECT_RATIO:
        raise SystemExit(f"Aspect ratio must not exceed {MAX_ASPECT_RATIO}:1")

    pixels = width * height
    if pixels < MIN_PIXELS or pixels > MAX_PIXELS:
        raise SystemExit(f"Total pixel count must be between {MIN_PIXELS} and {MAX_PIXELS}")



def validate_n(value: int) -> None:
    if value < 1:
        raise SystemExit("--n must be at least 1")



def validate_image_paths(image_paths: Sequence[str]) -> list[Path]:
    resolved = []
    for image_path in image_paths:
        path = Path(image_path)
        if not path.is_file():
            raise SystemExit(f"Input image not found: {image_path}")
        resolved.append(path)
    return resolved



def decode_and_save_images(data: Iterable[object], output_dir: Path, output_prefix: str) -> list[str]:
    output_files: list[str] = []
    for index, item in enumerate(data, start=1):
        b64_json = getattr(item, "b64_json", None)
        if not b64_json:
            raise SystemExit("Image response did not contain b64_json data")
        file_path = output_dir / f"{output_prefix}-{index:03d}.png"
        file_path.write_bytes(base64.b64decode(b64_json))
        output_files.append(str(file_path))
    return output_files



def write_metadata(
    *,
    output_dir: Path,
    output_prefix: str,
    mode: str,
    model: str,
    prompt: str,
    size: str,
    quality: str,
    input_images: Sequence[str],
    output_files: Sequence[str],
) -> str:
    metadata = {
        "mode": mode,
        "model": model,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "input_images": list(input_images),
        "output_files": list(output_files),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    metadata_path = output_dir / f"{output_prefix}.metadata.json"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(metadata_path)



def run_generate(client: OpenAI, args: argparse.Namespace) -> None:
    size = args.size or DEFAULT_SIZE
    validate_model(args.model)
    validate_size(size)
    validate_n(args.n)

    output_dir = ensure_output_dir(args.output_dir)
    output_prefix = args.output_prefix or "image"

    result = client.images.generate(
        model=args.model,
        prompt=args.prompt,
        size=size,
        quality=args.quality,
        n=args.n,
    )

    output_files = decode_and_save_images(result.data, output_dir, output_prefix)
    metadata_path = write_metadata(
        output_dir=output_dir,
        output_prefix=output_prefix,
        mode="generate",
        model=args.model,
        prompt=args.prompt,
        size=size,
        quality=args.quality,
        input_images=[],
        output_files=output_files,
    )
    print_summary(output_files, metadata_path, "generate", args.model, size, args.quality, [])



def run_edit(client: OpenAI, args: argparse.Namespace) -> None:
    size = args.size or DEFAULT_SIZE
    validate_model(args.model)
    validate_size(size)
    image_paths = validate_image_paths(args.image)

    output_dir = ensure_output_dir(args.output_dir)
    output_prefix = args.output_prefix or "edit"

    handles = [path.open("rb") for path in image_paths]
    try:
        result = client.images.edit(
            model=args.model,
            image=handles,
            prompt=args.prompt,
            size=size,
            quality=args.quality,
        )
    finally:
        for handle in handles:
            handle.close()

    output_files = decode_and_save_images(result.data, output_dir, output_prefix)
    metadata_path = write_metadata(
        output_dir=output_dir,
        output_prefix=output_prefix,
        mode="edit",
        model=args.model,
        prompt=args.prompt,
        size=size,
        quality=args.quality,
        input_images=[str(path) for path in image_paths],
        output_files=output_files,
    )
    print_summary(output_files, metadata_path, "edit", args.model, size, args.quality, [str(path) for path in image_paths])



def print_summary(
    output_files: Sequence[str],
    metadata_path: str,
    mode: str,
    model: str,
    size: str,
    quality: str,
    input_images: Sequence[str],
) -> None:
    summary = {
        "mode": mode,
        "model": model,
        "size": size,
        "quality": quality,
        "input_images": list(input_images),
        "output_files": list(output_files),
        "metadata_file": metadata_path,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))



def main() -> None:
    args = parse_args()
    client = build_client()

    if args.command == "generate":
        run_generate(client, args)
        return
    if args.command == "edit":
        run_edit(client, args)
        return

    raise SystemExit(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    main()
