
// ...existing code...

// Load profanity list from extension utils
async function loadProfanityList() {
    const url = chrome.runtime.getURL('utils/profanity_list.json');
    const response = await fetch(url);
    return response.json();
}

function getCaptionsFromDOM() {
    // Try to find YouTube captions in the DOM
    const captionNode = document.querySelector('.ytp-caption-segment, .caption-window, .ytp-caption-window-rollup');
    return captionNode ? captionNode.innerText : '';
}

function muteVideo(seconds = 2) {
    const video = document.querySelector('video');
    if (video) {
        video.muted = true;
        setTimeout(() => { video.muted = false; }, seconds * 1000);
    }
}

(async function() {
    const profanityList = await loadProfanityList();
    const profanityRegex = new RegExp(profanityList.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
    let lastCaption = '';

    setInterval(() => {
        const caption = getCaptionsFromDOM();
        if (caption && caption !== lastCaption) {
            lastCaption = caption;
            if (profanityRegex.test(caption)) {
                muteVideo(3);
                chrome.runtime.sendMessage({ type: 'PROFANITY_DETECTED', caption });
            }
        }
    }, 500);
})();

// Listen for mute toggle from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'TOGGLE_MUTE') {
        const video = document.querySelector('video');
        if (video) video.muted = !video.muted;
        sendResponse({ muted: video ? video.muted : false });
    }
});