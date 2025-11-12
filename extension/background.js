let isActive = true;

// --- CONFIGURATION: TARGET PLAYLIST ID SET ---
const TARGET_PLAYLIST_ID = 'PL9bNxWSVJqXGUy6ONwwJ02iVwkMjeE5hn'; 
const TARGET_PLAYLIST_URL = `https://www.youtube.com/playlist?list=${TARGET_PLAYLIST_ID}`;

// --- CONSTANTS ---
const PROCESSED_VIDEOS_KEY = 'processedVideoIds';
const WATCH_LATER_QUEUE_KEY = 'watchLaterQueue';
const CHECK_INTERVAL_MINUTES = 30;
const POLLING_INTERVAL_MS = 10000; // Check server status every 10 seconds (10,000 ms)
let isProcessingWatchLaterJob = false; // Runtime flag to enforce single job processing

// --- ALARM SETUP & PERIODIC CHECK ---

function setupAlarm() {
    // Prevents duplicated alarms on extension reload
    chrome.alarms.get('checkWatchLater', (alarm) => {
        if (!alarm) {
            chrome.alarms.create('checkWatchLater', {
                periodInMinutes: CHECK_INTERVAL_MINUTES
            });
            console.log(`Playlist check alarm set for every ${CHECK_INTERVAL_MINUTES} minutes.`);
        }
    });
}

chrome.runtime.onInstalled.addListener(setupAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkWatchLater') {
        checkTargetPlaylist();
    }
});
setupAlarm(); 

function checkTargetPlaylist() {
    console.log(`Running periodic check for playlist ID: ${TARGET_PLAYLIST_ID}`);
    // 1. Create a non-active tab to run the parser script
    chrome.tabs.create({ url: TARGET_PLAYLIST_URL, active: false }, (tempTab) => {
        // 2. Wait a moment for the page to load
        setTimeout(() => {
            // 3. Execute the parser content script
            chrome.scripting.executeScript({
                target: { tabId: tempTab.id },
                files: ['watch_later_parser.js']
            }, () => {
                // 4. Close the temporary tab after a brief delay
                setTimeout(() => chrome.tabs.remove(tempTab.id), 5000);
            });
        }, 8000); // 8 seconds to allow YouTube SPA to load video list
    });
}

// --- QUEUE MANAGEMENT FUNCTIONS (Controls the one-at-a-time flow) ---

function dequeueAndProcess() {
    if (isProcessingWatchLaterJob) {
        console.log('A video job is already running. Waiting...');
        return;
    }

    chrome.storage.local.get({ [WATCH_LATER_QUEUE_KEY]: [] }, (data) => {
        const queue = data[WATCH_LATER_QUEUE_KEY];
        if (queue.length === 0) {
            console.log('Processing queue is empty.');
            isProcessingWatchLaterJob = false;
            return;
        }

        isProcessingWatchLaterJob = true;
        const { url, videoId } = queue[0]; // Peek at the first item

        // Start the job and the polling chain
        processVideoFromQueue(url, videoId);
    });
}

function markVideoAsProcessed(videoId, success = true) {
    // 1. Remove the video from the queue (must be the first item)
    chrome.storage.local.get({ [WATCH_LATER_QUEUE_KEY]: [] }, (data) => {
        let queue = data[WATCH_LATER_QUEUE_KEY];
        if (queue.length > 0 && queue[0].videoId === videoId) {
            queue.shift(); // Remove the video that was just processed
        }
        chrome.storage.local.set({ [WATCH_LATER_QUEUE_KEY]: queue }, () => {
            console.log(`[${videoId}] Removed from queue. Remaining: ${queue.length}`);
        });
    });

    // 2. Add the video ID to the processed list if the job finished successfully
    if (success) {
        chrome.storage.local.get({ [PROCESSED_VIDEOS_KEY]: [] }, (data) => {
            const processedIds = new Set(data[PROCESSED_VIDEOS_KEY]);
            processedIds.add(videoId);
            chrome.storage.local.set({ [PROCESSED_VIDEOS_KEY]: Array.from(processedIds) });
            console.log(`[${videoId}] Marked as PROCESSED.`);
        });
    }

    // 3. Free up the flag and check the queue again for the next job
    isProcessingWatchLaterJob = false;
    dequeueAndProcess(); // THIS starts the next video, enforcing sequential processing
}

// --- CORE PROCESSING LOGIC WITH STRICT POLLING ---

function processVideoFromQueue(url, videoId) {
    // 1. Get custom words from storage
    chrome.storage.local.get({ customProfanity: [] }, (data) => {
        const customProfanity = data.customProfanity || [];
        
        console.log(`[${videoId}] Sending POST /process to start job...`);

        // Send the initial request to start processing
        fetch('http://localhost:5000/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url, custom_words: customProfanity })
        })
        .then(res => res.json())
        .then(data => {
            if (data.job_id) {
                console.log(`[${videoId}] Job started. ID: ${data.job_id}. Starting polling.`);
                // 2. Start polling for the status of the job
                pollJobStatus(data.job_id, videoId);
            } else {
                throw new Error("Server response missing job_id.");
            }
        })
        .catch(e => {
            console.error(`[${videoId}] Failed to start job. Moving queue:`, e);
            markVideoAsProcessed(videoId, false); // Mark failure and move queue
        });
    });
}

function pollJobStatus(jobId, videoId) {
    fetch(`http://localhost:5000/status/${jobId}`)
    .then(res => res.json())
    .then(data => {
        console.log(`[${videoId}] Status: ${data.status}`);

        if (data.status === 'done') {
            // 3. Job is done. Fetch the final schedule.
            console.log(`[${videoId}] Job done. Fetching mute schedule...`);
            return fetchMuteSchedule(jobId, videoId);
        } else if (data.status === 'error') {
            // Job failed on the server
            throw new Error("Job failed on AI server.");
        } else {
            // Job is still processing (downloading, transcribing). Poll again.
            setTimeout(() => pollJobStatus(jobId, videoId), POLLING_INTERVAL_MS);
        }
    })
    .catch(e => {
        console.error(`[${videoId}] Polling error or job failed. Moving queue:`, e);
        markVideoAsProcessed(videoId, false); // Mark failure and move queue
    });
}

function fetchMuteSchedule(jobId, videoId) {
    fetch(`http://localhost:5000/mute_schedule/${jobId}`)
    .then(res => res.json())
    .then(data => {
        // 4. Mute schedule received. Save it and move the queue.
        if (data.mute_schedule) {
            console.log(`[${videoId}] Successfully received mute schedule (${data.mute_schedule.length} entries).`);
            
            // Store the schedule result associated with the video ID
            chrome.storage.local.set({
                [`schedule_${videoId}`]: {
                    url: data.url, 
                    schedule: data.mute_schedule
                }
            }, () => {
                // Success: Mark as processed and trigger the next video
                markVideoAsProcessed(videoId, true); 
            });
            
        } else {
            throw new Error("Mute schedule not found in response.");
        }
    })
    .catch(e => {
        console.error(`[${videoId}] Failed to fetch mute schedule. Moving queue:`, e);
        // Failure: Mark as processed (unsuccessful) and trigger the next video
        markVideoAsProcessed(videoId, false); 
    });
}


// --- MESSAGE LISTENER ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_STATUS') {
        sendResponse({ isActive });
    }
    if (msg.type === 'TOGGLE_ACTIVE') {
        isActive = !isActive;
        sendResponse({ isActive });
    }
    
    // Manual SEND_TO_AI_SERVER handler: sends custom words
    if (msg.type === 'SEND_TO_AI_SERVER') {
        chrome.storage.local.get({ customProfanity: [] }, (data) => {
            const customWords = data.customProfanity || [];
            
            fetch('http://localhost:5000/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: msg.url, custom_words: customWords })
            })
            .then(res => res.json())
            .then(data => sendResponse({ success: true, data }))
            .catch(() => sendResponse({ success: false }))
        });
        return true; 
    }

    // WATCH_LATER_URLS Handler: adds all received URLs to queue and starts processing
    if (msg.type === 'WATCH_LATER_URLS') {
        const urls = msg.urls;
        console.log(`Received ${urls.length} total videos from target playlist.`);

        chrome.storage.local.get({ [PROCESSED_VIDEOS_KEY]: [], [WATCH_LATER_QUEUE_KEY]: [] }, (data) => {
            const processedIds = new Set(data[PROCESSED_VIDEOS_KEY]);
            let queue = data[WATCH_LATER_QUEUE_KEY];
            const newVideosAdded = [];
            
            urls.forEach(url => {
                const videoIdMatch = url.match(/(?<=v=)[a-zA-Z0-9_-]{11}/);
                const videoId = videoIdMatch ? videoIdMatch[0] : null;

                const alreadyInQueue = queue.some(item => item.videoId === videoId);

                // Only add to queue if NOT processed AND NOT already in queue
                if (videoId && !processedIds.has(videoId) && !alreadyInQueue) {
                    queue.push({ url, videoId });
                    newVideosAdded.push(videoId);
                }
            });

            if (newVideosAdded.length > 0) {
                chrome.storage.local.set({ [WATCH_LATER_QUEUE_KEY]: queue }, () => {
                    console.log(`Added ${newVideosAdded.length} new videos to queue. Total size: ${queue.length}`);
                    dequeueAndProcess();
                });
            } else {
                 console.log('No new videos found to process.');
            }
        });
    }
});