# ai-server/whisperx_pipeline.py

import whisperx
import torch
import json
from pathlib import Path
import logging

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

def generate_mute_schedule(audio_path: str, cache_dir: Path = Path(__file__).parent / "cache") -> list:
    """
    Transcribe audio using WhisperX and generate a mute schedule for profanity.
    
    Args:
        audio_path (str): Path to the audio file.
        cache_dir (Path): Directory to store cached results.
        
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
    
    # Transcribe
    result = model.transcribe(audio_path)
    
    # Align timestamps
    model_a, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
    result_aligned = whisperx.align(result["segments"], model_a, metadata, audio_path, device)
    
    mute_schedule = []
    
    # Scan segments for profanity
    for segment in result_aligned["segments"]:
        text = segment["text"].lower()
        for word in PROFANITY_LIST:
            if word.lower() in text:
                mute_schedule.append({
                    "start": float(segment["start"]),
                    "end": float(segment["end"]),
                    "word": word
                })
    
    # Save to cache
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(mute_schedule, f, indent=2)
    
    logging.info(f"Mute schedule generated: {len(mute_schedule)} entries")
    return mute_schedule
