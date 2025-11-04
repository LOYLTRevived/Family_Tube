# ai-server/app.py

from fastapi import FastAPI, BackgroundTasks, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uuid
import logging
from utils import download_audio
from whisperx_pipeline import generate_mute_schedule

app = FastAPI()

# CORS setup for Chrome extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development; restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logger setup
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(message)s")

# In-memory job store (replace with Redis/DB in production)
jobs = {}


class ProcessRequest(BaseModel):
    url: str
    custom_words: list[str] | None = []


@app.get("/health")
async def health():
    """Simple health check endpoint"""
    return {"status": "ok"}


@app.post("/process")
async def process_video(request: Request, background_tasks: BackgroundTasks):
    """Start processing a YouTube video for audio muting"""
    data = await request.json()
    video_url = data.get("url")
    custom_words = data.get("custom_words", [])

    if not video_url:
        raise HTTPException(status_code=400, detail="Missing 'url' in request body")

    # Create job entry
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "queued", "url": video_url, "mute_schedule": None}

    logging.info(f"Received processing request for {video_url} (job_id={job_id})")

    # Start background job
    background_tasks.add_task(process_job, video_url, job_id, custom_words)

    return {"job_id": job_id, "url": video_url, "status": "queued"}


def process_job(url: str, job_id: str, custom_words: list[str]):
    """Download audio, transcribe, and generate mute schedule in background"""
    try:
        jobs[job_id]["status"] = "downloading"
        audio_path = download_audio(url)
        logging.info(f"[{job_id}] Downloaded audio to {audio_path}")

        jobs[job_id]["status"] = "transcribing"
        mute_schedule = generate_mute_schedule(audio_path, custom_words=custom_words)
        logging.info(f"[{job_id}] Generated mute schedule ({len(mute_schedule)} entries)")

        jobs[job_id]["status"] = "done"
        jobs[job_id]["mute_schedule"] = mute_schedule

    except Exception as e:
        logging.error(f"Job {job_id} failed: {e}")
        jobs[job_id]["status"] = "error"
        jobs[job_id]["mute_schedule"] = []


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    """Check the status of a processing job"""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "status": job["status"], "url": job["url"]}


@app.get("/mute_schedule/{job_id}")
async def get_mute_schedule(job_id: str):
    """Get the mute schedule for a completed job"""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] != "done":
        raise HTTPException(status_code=202, detail="Job still processing")

    return {
        "job_id": job_id,
        "url": job["url"],
        "mute_schedule": job["mute_schedule"],
    }
