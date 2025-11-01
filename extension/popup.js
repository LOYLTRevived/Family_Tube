// ...existing code...

function updateStatus(isActive) {
    document.getElementById('active-status').textContent = isActive ? 'Active' : 'Inactive';
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
            if (response && response.success) {
                document.getElementById('processing-state').textContent = 'Sent!';
            } else {
                document.getElementById('processing-state').textContent = 'Failed!';
            }
        });
    });
};

chrome.runtime.sendMessage({ type: 'GET_STATUS' }, response => {
    updateStatus(response.isActive);
});