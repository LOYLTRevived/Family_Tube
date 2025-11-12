# ai-server/whisperx_pipeline.py

import whisperx
import torch
import json
from pathlib import Path
import logging
import gc

# Configure logging
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(message)s")

# Profanity list file paths
BACKEND_PROFANITY_FILE = Path(__file__).parent / "utils" / "profanity_list.json"
EXTENSION_PROFANITY_FILE = Path(__file__).parents[1] / "extension" / "utils" / "profanity_list.json"


def load_profanity_list():
    """Load and merge profanity lists from backend and Chrome extension."""
    words = set()

    # Load backend list
    try:
        with open(BACKEND_PROFANITY_FILE, "r", encoding="utf-8") as f:
            backend_words = json.load(f)
            words.update(backend_words)
            logging.info(f"Loaded {len(backend_words)} words from backend list.")
    except Exception as e:
        logging.warning(f"Backend profanity list missing or invalid: {e}")

    # Load extension list (if exists)
    try:
        with open(EXTENSION_PROFANITY_FILE, "r", encoding="utf-8") as f:
            extension_words = json.load(f)
            words.update(extension_words)
            logging.info(f"Loaded {len(extension_words)} custom words from Chrome extension.")
    except Exception as e:
        logging.warning(f"Extension profanity list missing or invalid: {e}")

    return list(words)


# Initialize base profanity list
BASE_PROFANITY_LIST = load_profanity_list()


def generate_mute_schedule(
    audio_path: str,
    cache_dir: Path = Path(__file__).parent / "cache",
    buffer: float = 0.17,
    custom_words: list = None  # 🧠 optional param from extension via backend
    ) -> list:
    """
    Transcribe audio using WhisperX and generate a mute schedule for profanity (line-level scan + buffer).

    Args:
    	audio_path (str): Path to the audio file.
    	cache_dir (Path): Directory to store cached results.
    	buffer (float): Time in seconds to extend before and after each mute zone.
    	custom_words (list): Extra profanity words passed from the extension.
    """
    cache_dir.mkdir(exist_ok=True)
    cache_file = cache_dir / (Path(audio_path).stem + "_mute.json")

    # Use cached schedule if available
    if cache_file.exists():
        logging.info(f"Loading cached mute schedule from {cache_file}")
        with open(cache_file, "r", encoding="utf-8") as f:
            return json.load(f)

    # Merge all sources of profanity words
    custom_words = custom_words or []
    profanity_list = list(set(
    	[w.strip().lower() for w in BASE_PROFANITY_LIST if w.strip()] +
    	[w.strip().lower() for w in custom_words if w.strip()]
    ))

    logging.info(f"Total profanity words loaded: {len(profanity_list)} (including {len(custom_words)} custom)")

    # Transcribe and align audio
    logging.info(f"Transcribing audio: {audio_path}")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    # --- Step 1: Transcription ---
    model = whisperx.load_model("large", device)
    result = model.transcribe(audio_path)
    
    # New Logic: Explicitly delete model and free memory
    logging.info("Transcription complete. Releasing Whisper model from GPU memory.")
    del model
    if device == "cuda":
        torch.cuda.empty_cache()
    # ------------------------------

    # --- Step 2: Alignment ---
    model_a, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
    result_aligned = whisperx.align(result["segments"], model_a, metadata, audio_path, device)
    
    # New Logic: Explicitly delete model and free memory
    logging.info("Alignment complete. Releasing alignment model from GPU memory.")
    del model_a
    if device == "cuda":
        torch.cuda.empty_cache()
    # ------------------------------

    mute_schedule = []

    # Detect profanity (line-level)
    for segment in result_aligned["segments"]:
        segment_text = segment["text"].lower()
        segment_start = float(segment["start"])
        segment_end = float(segment["end"])

        for bad_word in profanity_list:
            if bad_word in segment_text:
                start = max(0, segment_start - buffer)
                end = segment_end + buffer
                mute_schedule.append({
                    "start": start,
                    "end": end,
                    "word": bad_word
                })
    # Merge overlapping mute zones
    mute_schedule.sort(key=lambda x: x["start"])
    merged = []
    for m in mute_schedule:
        if not merged or m["start"] > merged[-1]["end"]:
            merged.append(m)
        else:
            merged[-1]["end"] = max(merged[-1]["end"], m["end"])
    # Optional: filter out extremely long mute zones (>7s)
    filtered = [entry for entry in merged if (entry["end"] - entry["start"]) <= 7.0]

    # Cache result
    with open(cache_file, "w", encoding="utf-8") as f:
    	json.dump(filtered, f, indent=2)


    logging.info(f"Mute schedule generated: {len(filtered)} entries (line-level + {buffer:.1f}s buffer)")

    # New Logic: Final garbage collection before returning
    logging.info("Performing final garbage collection and clearing CUDA cache.")
    gc.collect()
    if device == "cuda":
        torch.cuda.empty_cache()
    # ------------------------------
    
    return filtered
