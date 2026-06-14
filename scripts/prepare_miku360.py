#!/usr/bin/env python3
"""Prepare an already-authorized equirectangular 360 MP4 for the PWA."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a real 2:1 equirectangular 360 MP4 into app/main_pwa/assets/miku360.mp4."
    )
    parser.add_argument("--input", required=True, help="Source equirectangular 360 MP4.")
    parser.add_argument("--output", default="./app/main_pwa/assets/miku360.mp4", help="Output MP4 path.")
    parser.add_argument("--start", help="Optional start timestamp, e.g. 00:00:00.")
    parser.add_argument("--duration", help="Optional duration, e.g. 00:01:30.")
    parser.add_argument("--width", type=int, default=3840, choices=[2560, 3840], help="Output width.")
    parser.add_argument("--height", type=int, default=1920, choices=[1280, 1920], help="Output height.")
    parser.add_argument("--force", action="store_true", help="Allow resize/pad when the source is not 2:1.")
    return parser.parse_args()


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        print(f"ERROR: {name} is not installed or not on PATH.", file=sys.stderr)
        sys.exit(1)
    return path


def probe_video(ffprobe: str, source: Path) -> dict:
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,duration",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(source),
    ]
    result = subprocess.run(cmd, check=True, text=True, capture_output=True)
    data = json.loads(result.stdout)
    stream = data.get("streams", [{}])[0]
    return {
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
        "duration": stream.get("duration") or data.get("format", {}).get("duration") or "unknown",
    }


def is_two_to_one(width: int, height: int) -> bool:
    if not width or not height:
        return False
    return abs((width / height) - 2.0) <= 0.02


def build_ffmpeg_command(ffmpeg: str, args: argparse.Namespace, source: Path, output: Path, source_is_2_to_1: bool) -> list[str]:
    cmd = [ffmpeg, "-y"]
    if args.start:
        cmd.extend(["-ss", args.start])
    cmd.extend(["-i", str(source)])
    if args.duration:
        cmd.extend(["-t", args.duration])

    if source_is_2_to_1:
        vf = f"scale={args.width}:{args.height}:force_original_aspect_ratio=decrease,pad={args.width}:{args.height}:(ow-iw)/2:(oh-ih)/2"
    else:
        vf = f"scale={args.width}:{args.height}:force_original_aspect_ratio=decrease,pad={args.width}:{args.height}:(ow-iw)/2:(oh-ih)/2"

    cmd.extend(
        [
            "-vf",
            vf,
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            str(output),
        ]
    )
    return cmd


def main() -> int:
    args = parse_args()
    ffmpeg = require_tool("ffmpeg")
    ffprobe = require_tool("ffprobe")

    source = Path(args.input).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()

    if not source.exists():
        print(f"ERROR: input file does not exist: {source}", file=sys.stderr)
        return 1

    info = probe_video(ffprobe, source)
    source_is_2_to_1 = is_two_to_one(info["width"], info["height"])

    print(f"Input: {source}")
    print(f"Source resolution: {info['width']}x{info['height']}")
    print(f"Source duration: {info['duration']}")

    if not source_is_2_to_1 and not args.force:
        print(
            "ERROR: input is not a 2:1 equirectangular 360 video. "
            "Use --force only for simple resize/pad; it will not create real 360 video.",
            file=sys.stderr,
        )
        return 1

    if not source_is_2_to_1 and args.force:
        print(
            "WARNING: --force was used. This is only resize/pad and does not convert ordinary 2D footage into real 360 video.",
            file=sys.stderr,
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    cmd = build_ffmpeg_command(ffmpeg, args, source, output, source_is_2_to_1)
    subprocess.run(cmd, check=True)

    final_info = probe_video(ffprobe, output)
    print("Done.")
    print(f"Output: {output}")
    print(f"Output resolution: {final_info['width']}x{final_info['height']}")
    print(f"Output duration: {final_info['duration']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
