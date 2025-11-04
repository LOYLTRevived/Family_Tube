# ai-server/whisperx_pipeline.py

import whisperx
import torch
import json
from pathlib import Path
import logging
import re
import string

# Configure logging
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(message)s")

# Profanity list path
PROFANITY_FILE = Path(__file__).parent / "utils" / "profanity_list.json"

# Load profanity list
try:
    with open(PROFANITY_FILE, "r", encoding="utf-8") as f:
        PROFANITY_LIST = json.load(f)
except Exception as e:
    logging.error(f"Failed to load profanity list: {e}")
    PROFANITY_LIST = []

def generate_mute_schedule(
    audio_path: str,
    cache_dir: Path = Path(__file__).parent / "cache",
    buffer: float = 0.17
) -> list:
    """
    Transcribe audio using WhisperX and generate a mute schedule for profanity (line-level scan + buffer).
    
    Args:
        audio_path (str): Path to the audio file.
        cache_dir (Path): Directory to store cached results.
        buffer (float): Time in seconds to extend before and after each mute zone.
        
    Returns:
        list: List of dicts with 'start', 'end', and 'word'.
    """
    cache_dir.mkdir(exist_ok=True)
    cache_file = cache_dir / (Path(audio_path).stem + "_mute.json")

    # Return cached schedule if exists
    if cache_file.exists():
        logging.info(f"Loading cached mute schedule from {cache_file}")
        with open(cache_file, "r", encoding="utf-8") as f:
            return json.load(f)

    logging.info(f"Transcribing audio: {audio_path}")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = whisperx.load_model("large", device)

    result = model.transcribe(audio_path)
    model_a, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
    result_aligned = whisperx.align(result["segments"], model_a, metadata, audio_path, device)

    mute_schedule = []

    # Line-level detection (checks whole segment text)
    for segment in result_aligned["segments"]:
        segment_text = segment["text"].lower()
        segment_start = float(segment["start"])
        segment_end = float(segment["end"])

        for bad_word in PROFANITY_LIST:
            bad_word_norm = bad_word.lower().strip()
            if bad_word_norm in segment_text:
                # Add mute zone for the whole segment + buffer
                start = max(0, segment_start - buffer)
                end = segment_end + buffer
                mute_schedule.append({
                    "start": start,
                    "end": end,
                    "word": bad_word_norm
                })

    # Merge overlapping mute zones
    mute_schedule.sort(key=lambda x: x["start"])
    merged = []
    for m in mute_schedule:
        if not merged or m["start"] > merged[-1]["end"]:
            merged.append(m)
        else:
            merged[-1]["end"] = max(merged[-1]["end"], m["end"])

    filtered = [entry for entry in merged if (entry["end"] - entry["start"]) <= 7.0]

    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(filtered, f, indent=2)

    logging.info(f"Mute schedule generated: {len(merged)} entries (line-level + {buffer:.1f}s buffer)")
    return merged
