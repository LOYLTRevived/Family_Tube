# 🎧 YouTube Audio Censor

**Automatically mute YouTube videos when profanity appears in captions. Optionally, process audio with a local AI backend for advanced filtering.**

---

## 🚀 Features

* **Real-time muting** of YouTube videos based on auto-generated captions.
* **Optional AI backend** using WhisperX for full audio analysis.
* **Export mute schedules** for offline playback.
* **Easy installation** as a Chrome extension.
* **Local caching** for processed videos.
* Fully **open-source and free** to use, modify, and distribute.

---

## 💻 System & GPU Requirements

To run the AI backend (WhisperX transcription and profanity detection), the following system specifications are recommended:

### **Minimum Requirements**

* **OS:** Windows 10 or later
* **GPU:** NVIDIA GPU with CUDA support (e.g., GTX 10xx series or higher)
* **VRAM:** 4 GB
* **CPU:** Quad-core processor
* **RAM:** 8 GB
* **Disk:** 10 GB free space for downloads, cache, and temporary files

### **Recommended Requirements**

* **GPU:** NVIDIA RTX 20xx/30xx series with CUDA support
* **VRAM:** 8 GB or more
* **CPU:** Hexa-core or higher
* **RAM:** 16 GB or more
* **Disk:** SSD for faster read/write operations
* **Optional:** High-speed internet for downloading YouTube videos

> ⚠️ WhisperX leverages the GPU for real-time transcription. Running on CPU is **not recommended**, as it will be significantly slower.

---

## 🏗️ Project Structure

```
youtube-audio-censor/
│
├── LICENSE
├── README.md
├── .gitignore
├── environment.yml
│
├── /extension/                  # Chrome Extension
│   ├── manifest.json
│   ├── content.js
│   ├── popup.html
│   ├── popup.js
│   ├── background.js
│   ├── styles.css
│   ├── assets/
│   └── utils/
│       └── profanity_list.json
│
├── /ai-server/                  # Local backend
│   ├── app.py
│   ├── whisperx_pipeline.py
│   ├── utils.py
│   ├── downloads/
│   ├── cache/
│   └── tests/
│       ├── test_api.py
│       └── test_pipeline.py
│
└── /docs/
    ├── setup.md
    ├── architecture.md
    ├── api_reference.md
    └── changelog.md
```

---

## ⚙️ Installation

### 1. Clone the repository

```bash
git clone https://github.com/<yourname>/youtube-audio-censor.git
cd youtube-audio-censor
```

### 2. Set up the Conda environment

```bash
conda env create -f environment.yml
conda activate youtube-audio-censor
```

### 3. Load the Chrome Extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `/extension/` folder

### 4. Run the AI backend (optional)

```bash
cd ai-server
uvicorn app:app --reload
```

* The Chrome extension can now send video URLs to `http://localhost:5000/process` for advanced processing.

---

## 📝 Usage

1. Open YouTube and ensure captions are enabled.
2. Click the extension icon:

   * **Activate / Deactivate muting**
   * **Send video to AI server**
3. The extension automatically mutes profanity in real-time.
4. Export mute schedules for offline playback (JSON format).

---

## 🧩 Development

* **Chrome Extension:** `content.js`, `background.js`, `popup.js`
* **Backend:** `app.py`, `whisperx_pipeline.py`, `utils.py`
* **Testing:** `ai-server/tests/`
* **Docs:** `/docs/` — setup, architecture, API reference, changelog

---

## 🛠️ Tech Stack

* **Frontend:** Chrome Extension (HTML, JS, CSS)
* **Backend:** Python 3.10, FastAPI, WhisperX, Torch, yt-dlp
* **Environment Management:** Conda
* **Testing:** Pytest

---

## 📄 License

This project is licensed under the **MIT License** – see [LICENSE](LICENSE) for details.
You are free to **use, modify, and distribute** this software for any purpose.

---

## 💡 Future Enhancements

* Nudity detection using `OpenCV + CLIP`
* Custom word lists per user (sync via Chrome storage)
* Offline mode exporting muted MP4 files
* Optimized caching for faster processing

---

## ❤️ Contributing

1. Fork the repo
2. Create a branch (`git checkout -b feature-name`)
3. Make your changes
4. Commit (`git commit -am 'Add feature'`)
5. Push (`git push origin feature-name`)
6. Open a Pull Request

---

## 🔗 Contact

**Elijah Taylor** – `elijah6637@gmail.com`
GitHub: [github.com/LOYLTRevived] (https://github.com/LOYLTRevived/Family_Tube)