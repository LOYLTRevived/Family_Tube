let isActive = true;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PROFANITY_DETECTED') {
        // Optionally handle logging or analytics here
        // e.g., chrome.notifications.create({ ... })
    }
    if (msg.type === 'GET_STATUS') {
        sendResponse({ isActive });
    }
    if (msg.type === 'TOGGLE_ACTIVE') {
        isActive = !isActive;
        sendResponse({ isActive });
    }
    if (msg.type === 'SEND_TO_AI_SERVER') {
        fetch('http://localhost:5000/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: msg.url })
        })
        .then(res => res.json())
        .then(data => sendResponse({ success: true, data }))
        .catch(() => sendResponse({ success: false }))
        return true; // Keep the message channel open for async response
    }
});