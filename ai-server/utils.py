# ai-server/utils.py

import os
import subprocess
import logging
from pathlib import Path

# Directory for audio downloads
DOWNLOAD_DIR = Path(__file__).parent / "downloads"
DOWNLOAD_DIR.mkdir(exist_ok=True)

def download_audio(video_url: str, output_dir: Path = DOWNLOAD_DIR) -> str:
    """
    Downloads the best available audio from a YouTube video using yt-dlp.
    Skips MP3 conversion to avoid encoder issues and keeps native format (e.g., .webm or .m4a).

    Args:
        video_url (str): The YouTube video URL.
        output_dir (Path): Directory where the file will be saved.

    Returns:
        str: Path to the downloaded audio file.
    """
    try:
        logging.info(f"Downloading audio from: {video_url}")
        cmd = [
            "yt-dlp",
            "-f", "bestaudio[ext=webm]/bestaudio",
            "-o", f"{output_dir}/%(id)s.%(ext)s",
            video_url,
        ]
        subprocess.run(cmd, check=True)

        # Find most recent audio file (yt-dlp names files by video ID)
        files = sorted(output_dir.glob("*.*"), key=os.path.getmtime, reverse=True)
        if not files:
            raise FileNotFoundError("No audio file found after download.")

        latest_file = str(files[0])
        logging.info(f"Downloaded file: {latest_file}")
        return latest_file

    except subprocess.CalledProcessError as e:
        logging.error(f"Error downloading video: {e}")
        raise RuntimeError("yt-dlp failed to download audio.")
