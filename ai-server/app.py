# ai-server/app.py

from fastapi import FastAPI, BackgroundTasks, HTTPException
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
    allow_origins=["*"],  # For development; restrict in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logger setup
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(message)s")

# In-memory job store (replace with DB/Redis in prod)
jobs = {}

class ProcessRequest(BaseModel):
    url: str

@app.get("/health")
async def health():
    """Simple health check endpoint"""
    return {"status": "ok"}

@app.post("/process")
async def process_video(req: ProcessRequest, background_tasks: BackgroundTasks):
    """Start processing a YouTube video for audio muting"""
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "processing", "url": req.url, "mute_schedule": None}
    logging.info(f"Received processing request for {req.url} (job_id={job_id})")
    background_tasks.add_task(process_job, req.url, job_id)
    return {"job_id": job_id, "url": req.url, "status": "processing"}

def process_job(url, job_id):
    try:
        jobs[job_id]["status"] = "downloading"
        audio_path = download_audio(url)
        logging.info(f"Downloaded audio to {audio_path}")

        jobs[job_id]["status"] = "transcribing"
        mute_schedule = generate_mute_schedule(audio_path)
        
        jobs[job_id]["status"] = "done"
        jobs[job_id]["mute_schedule"] = mute_schedule
        logging.info(f"Completed job {job_id} with {len(mute_schedule)} entries")

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
