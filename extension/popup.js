// ...existing code...

function updateStatus(isActive) {
    document.getElementById('active-status').textContent = isActive ? 'Active' : 'Inactive';
}

function checkMuteScheduleStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs.length) return;
        const url = tabs[0].url;
        const baseUrl = getBaseVideoUrl(url);
        chrome.storage.local.get(['muteSchedule', 'muteScheduleUrl'], data => {
            if (data.muteSchedule && data.muteSchedule.length && data.muteScheduleUrl === baseUrl) {
                document.getElementById('mute-schedule-loaded').textContent = 'Loaded';
            } else {
                document.getElementById('mute-schedule-loaded').textContent = 'Not Loaded';
            }
        });
    });
}

function getBaseVideoUrl(url) {
    try {
        const u = new URL(url);
        if (u.hostname.includes('youtube.com') && u.searchParams.has('v')) {
            return `https://www.youtube.com/watch?v=${u.searchParams.get('v')}`;
        }
        return u.origin + u.pathname;
    } catch {
        return url;
    }
}

document.getElementById('mute-toggle').onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_MUTE' }, response => {
            // Optionally update UI based on mute state
        });
    });
};

document.getElementById('send-ai').onclick = () => {
    document.getElementById('processing-state').textContent = 'Processing...';
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const url = tabs[0].url;
        chrome.runtime.sendMessage({ type: 'SEND_TO_AI_SERVER', url }, response => {
            if (response && response.success && response.data.job_id) {
                pollForMuteSchedule(response.data.job_id, url);
            } else {
                document.getElementById('processing-state').textContent = 'Failed!';
            }
        });
    });
};

async function sendToAIServer(videoUrl) {
    // Get custom words from storage
    const data = await new Promise(resolve => {
        chrome.storage.local.get({ customProfanity: [] }, resolve);
    });

    const customProfanity = data.customProfanity || [];

    const response = await fetch("http://localhost:5000/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            url: videoUrl,
            custom_words: customProfanity // 🧠 include custom list
        })
    });

    const result = await response.json();
    console.log("AI Server response:", result);
}

function pollForMuteSchedule(jobId, url, attempt = 0) {
    fetch(`http://localhost:5000/status/${jobId}`)
        .then(res => res.json())
        .then(statusData => {
            // Send progress to content script
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'AI_PROGRESS',
                    status: statusData.status,
                    url: url
                });
            });

            if (statusData.status === "done") {
                fetch(`http://localhost:5000/mute_schedule/${jobId}`)
                    .then(res => res.json())
                    .then(scheduleData => {
                        chrome.storage.local.set({ muteSchedule: scheduleData.mute_schedule, muteScheduleUrl: getBaseVideoUrl(url) }, () => {
                            document.getElementById('processing-state').textContent = 'Mute Schedule Loaded – Profanity Auto-Muted';
                            checkMuteScheduleStatus();
                            // Notify overlay to hide
                            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                                chrome.tabs.sendMessage(tabs[0].id, {
                                    type: 'AI_PROGRESS',
                                    status: 'complete',
                                    url: url
                                });
                            });
                        });
                    });
            } else if (statusData.status === "error") {
                document.getElementById('processing-state').textContent = 'Processing failed!';
                // Notify overlay to hide
                chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: 'AI_PROGRESS',
                        status: 'error',
                        url: url
                    });
                });
            } else {
                setTimeout(() => pollForMuteSchedule(jobId, url, attempt + 1), 2000);
            }
        })
        .catch(() => {
            document.getElementById('processing-state').textContent = 'Error contacting server!';
        });
}

function renderCustomWords() {
    chrome.storage.local.get({ customProfanity: [] }, data => {
        const list = document.getElementById('custom-word-list');
        list.innerHTML = '';
        data.customProfanity.forEach(word => {
            const li = document.createElement('li');
            li.textContent = word + ' ';
            const delBtn = document.createElement('button');
            delBtn.textContent = 'Delete';
            delBtn.style.marginLeft = '8px';
            delBtn.onclick = () => {
                chrome.storage.local.get({ customProfanity: [] }, d => {
                    const updated = d.customProfanity.filter(w => w !== word);
                    chrome.storage.local.set({ customProfanity: updated }, renderCustomWords);
                });
            };
            li.appendChild(delBtn);
            list.appendChild(li);
        });
    });
}

document.getElementById('add-word-btn').onclick = () => {
    const input = document.getElementById('add-word-input');
    const word = input.value.trim();
    if (!word) return;
    chrome.storage.local.get({ customProfanity: [] }, data => {
        const customProfanity = data.customProfanity;
        if (!customProfanity.includes(word)) {
            customProfanity.push(word);
            chrome.storage.local.set({ customProfanity }, () => {
                document.getElementById('add-word-status').textContent = 'Added!';
                input.value = '';
                renderCustomWords();
                setTimeout(() => document.getElementById('add-word-status').textContent = '', 1000);
            });
        } else {
            document.getElementById('add-word-status').textContent = 'Already exists!';
            setTimeout(() => document.getElementById('add-word-status').textContent = '', 1000);
        }
    });
};

renderCustomWords();

chrome.runtime.sendMessage({ type: 'GET_STATUS' }, response => {
    updateStatus(response.isActive);
});

checkMuteScheduleStatus();

