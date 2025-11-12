// popup.js

function updateStatus(isActive) {
    document.getElementById('active-status').textContent = isActive ? 'Active' : 'Inactive';
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

function checkMuteScheduleStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs.length) return;

        const url = tabs[0].url;
        
        // 1. Determine the Video ID and the dynamic storage key name
        const currentBaseUrl = getBaseVideoUrl(url);
        const videoIdMatch = currentBaseUrl.match(/[?&]v=([^&]+)/); 
        const videoId = videoIdMatch ? videoIdMatch[1] : null;

        if (!videoId) {
            // Cannot determine video ID (e.g., viewing non-video page)
            document.getElementById('mute-schedule-loaded').textContent = 'Not Applicable';
            return;
        }

        const scheduleKey = `schedule_${videoId}`; 
        
        // 2. Request the dynamic schedule key from storage
        chrome.storage.local.get([scheduleKey], data => {
            
            // The item retrieved is the 'scheduleContainer' object, 
            // e.g., { schedule: [..], url: "..." }
            const scheduleContainer = data[scheduleKey]; 

            // 3. Check for the container object AND the nested 'schedule' array's length
            if (scheduleContainer && 
                Array.isArray(scheduleContainer.schedule) && 
                scheduleContainer.schedule.length > 0) 
            {
                // Success: The schedule is found and valid
                document.getElementById('mute-schedule-loaded').textContent = 'Loaded';
            } else {
                // Failure: No valid schedule data found
                document.getElementById('mute-schedule-loaded').textContent = 'Not Loaded';
            }
        });
    });
}

document.getElementById('mute-toggle').onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_MUTE' }, response => {
            // Optionally update UI based on mute state
        });
    });
};

document.getElementById('send-ai').onclick = () => {
    // 1. Immediately update UI to reflect queuing status
    document.getElementById('processing-state').textContent = 'Queuing Video...';
    
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs || tabs.length === 0) {
            document.getElementById('processing-state').textContent = 'Error: No active tab found.';
            return;
        }

        const url = tabs[0].url;
        
        // 2. Send the message. The background script will add it to the queue.
        chrome.runtime.sendMessage({ type: 'SEND_TO_AI_SERVER', url: url }, response => {
            
            // The response tells us if the video was successfully handed off to the queue
            if (response && response.success) {
                // Success: The video is now in the queue
                document.getElementById('processing-state').textContent = 'Added to Queue. Processing will begin shortly.';
            } else {
                // Failure to talk to background script or process the request
                document.getElementById('processing-state').textContent = 'Failed to add video to queue.';
            }
        });
    });
};




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

