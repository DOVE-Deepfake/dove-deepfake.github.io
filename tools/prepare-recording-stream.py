#!/usr/bin/env python3
"""Trim the mixed 183 clip and package eight 3-second MPEG-DASH segments."""

import argparse
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import xml.etree.ElementTree as ET


WEB_PAGE = Path(__file__).resolve().parents[1]
SOURCE = WEB_PAGE.parent / "miniFaceForensics" / "183_13.00s.mp4"
OUTPUT = WEB_PAGE / "assets" / "recording-test"
NS = {"d": "urn:mpeg:dash:schema:mpd:2011"}


def run(command):
    print(shlex.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), check=True)


def validate(clip, manifest):
    metadata = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "json", str(clip),
    ]))
    if abs(float(metadata["format"]["duration"]) - 24) > 0.01:
        raise RuntimeError("The cropped clip must be exactly 24 seconds.")
    root = ET.parse(manifest).getroot()
    representations = root.findall(".//d:Representation", NS)
    if len(representations) != 2:
        raise RuntimeError("Expected two quality levels.")
    for representation in representations:
        template = representation.find("d:SegmentTemplate", NS)
        timeline = template.find("d:SegmentTimeline", NS)
        timescale = int(template.get("timescale"))
        durations = []
        for interval in timeline.findall("d:S", NS):
            durations.extend([int(interval.get("d")) / timescale] * (int(interval.get("r", "0")) + 1))
        if len(durations) != 8 or any(abs(duration - 3) > 0.001 for duration in durations):
            raise RuntimeError(f"Expected eight 3-second intervals, got {durations}.")
        representation_id = representation.get("id")
        initialization = manifest.parent / template.get("initialization").replace("$RepresentationID$", representation_id)
        fragments = []
        for number in range(1, 9):
            filename = template.get("media").replace("$RepresentationID$", representation_id).replace("$Number%05d$", f"{number:05d}")
            fragment = manifest.parent / filename
            fragments.append(fragment)
            packets = json.loads(subprocess.check_output([
                "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_packets",
                "-show_entries", "packet=pts_time,duration_time,flags", "-of", "json", "pipe:0",
            ], input=initialization.read_bytes() + fragment.read_bytes()))["packets"]
            if len(packets) != 90 or "K" not in packets[0]["flags"]:
                raise RuntimeError(f"{filename} must contain 90 frames and begin with a keyframe.")
            if abs(min(float(packet["pts_time"]) for packet in packets) - (number - 1) * 3) > 0.001:
                raise RuntimeError(f"Unexpected presentation timestamp in {filename}.")
        # Decode the assembled fMP4 stream too; this works even when FFmpeg was
        # built without a DASH demuxer and cannot open MPD files directly.
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "null", "-",
        ], input=initialization.read_bytes() + b"".join(fragment.read_bytes() for fragment in fragments), check=True)
        print(f"Verified {representation.get('width')}×{representation.get('height')}: eight 3-second segments.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--overwrite", action="store_true", help="Regenerate an existing recording stream.")
    args = parser.parse_args()
    for executable in ("ffmpeg", "ffprobe"):
        if not shutil.which(executable):
            parser.error(f"{executable} is required.")
    if not args.source.is_file():
        parser.error(f"Missing source video: {args.source}")
    clip = args.output / "183_24s.mp4"
    manifest = args.output / "dash" / "out.mpd"
    if not args.overwrite and (clip.exists() or manifest.parent.exists()):
        parser.error("Output already exists; use --overwrite to regenerate it.")
    manifest.parent.mkdir(parents=True, exist_ok=True)
    overwrite = "-y" if args.overwrite else "-n"
    keyframes = ["-r", "30", "-g", "90", "-keyint_min", "90", "-sc_threshold", "0",
                 "-force_key_frames", "expr:gte(t,n_forced*3)"]
    run(["ffmpeg", "-hide_banner", "-loglevel", "warning", overwrite,
         "-i", args.source, "-t", "24", "-map", "0:v:0", "-an", "-c:v", "libx264",
         "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", *keyframes,
         "-movflags", "+faststart", clip])
    run(["ffmpeg", "-hide_banner", "-loglevel", "warning", overwrite,
         "-i", clip, "-map", "0:v:0", "-map", "0:v:0", "-an", "-c:v", "libx264",
         "-preset", "fast", "-pix_fmt", "yuv420p", *keyframes,
         "-b:v:0", "800k", "-b:v:1", "300k", "-filter:v:1", "scale=320:-2",
         "-seg_duration", "3", "-use_timeline", "1", "-use_template", "1",
         "-init_seg_name", "init-stream$RepresentationID$.m4s",
         "-media_seg_name", "chunk-stream$RepresentationID$-$Number%05d$.m4s",
         "-adaptation_sets", "id=0,streams=v", "-f", "dash", manifest])
    validate(clip, manifest)
    print(f"Recording stream ready: {manifest}")


if __name__ == "__main__":
    main()
