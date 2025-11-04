/**
 * Family-Friendly Tube - content.js
 * Injects into YouTube pages to filter, censor, and mute video based on live captions,
 * and also applies a pre-defined timed mute schedule.
 * Muting is triggered immediately upon detection of single words or the first two words of a phrase.
 */

// Global state variables
let singleWords = [];
let phrases = [];
let wordRegex = null; // Regex for single words
let phraseRegexes = []; // Array of objects containing regex for full phrases
let observer = null;
let isVideoMuted = false;
let lastMuteTime = 0;
let lastProcessedCaption = ""; // Stores the last unique caption text processed

// --- Mute Schedule Variables ---
let muteSchedule = []; // Array of {start: number, end: number} objects
let muteScheduleUrl = ""; // URL associated with the current schedule

let overlayTimeout = null;

// Constants
const MUTE_DURATION_MS = 500; // Mute for 0.5 seconds (for live caption profanity)
const MUTE_COOLDOWN_MS = 0; // Minimum time between auto-mutes (0ms = no cooldown)
const SCHEDULE_CHECK_INTERVAL_MS = 200; // Check video time every 200ms for schedule application

// --- Debug Logging Function ---
function debugLog(message, ...optionalParams) {
    console.log(`[FFT-Content] ${message}`, ...optionalParams);
}
// --- End Debug Logging Function ---


function showProgressOverlay(statusText) {
    let overlay = document.getElementById('fftube-ai-progress-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'fftube-ai-progress-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '20px';
        overlay.style.right = '20px';
        overlay.style.zIndex = '999999';
        overlay.style.background = 'rgba(30,30,30,0.95)';
        overlay.style.color = '#fff';
        overlay.style.padding = '18px 28px';
        overlay.style.borderRadius = '10px';
        overlay.style.fontSize = '1.2em';
        overlay.style.boxShadow = '0 2px 12px rgba(0,0,0,0.3)';
        overlay.style.fontFamily = 'sans-serif';
        overlay.style.maxWidth = '350px';
        overlay.style.textAlign = 'center';
        overlay.style.pointerEvents = 'none';
        document.body.appendChild(overlay);
    }
    overlay.textContent = statusText;
    overlay.style.display = 'block';
    if (overlayTimeout) clearTimeout(overlayTimeout);
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

function hideProgressOverlay(delay = 0) {
    if (overlayTimeout) clearTimeout(overlayTimeout);
    if (delay > 0) {
        overlayTimeout = setTimeout(() => {
            const overlay = document.getElementById('fftube-ai-progress-overlay');
            if (overlay) overlay.style.display = 'none';
        }, delay);
    } else {
        const overlay = document.getElementById('fftube-ai-progress-overlay');
        if (overlay) overlay.style.display = 'none';
    }
}

// --- Profanity List & Regex Management ---

/**
 * Loads the default profanity list and merges it with user-defined words from storage.
 */
async function loadProfanityList() {
    debugLog('Attempting to load and merge profanity lists...');
    try {
        const url = chrome.runtime.getURL('utils/profanity_list.json');
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const defaultList = await response.json();
        
        const data = await new Promise(resolve => {
            chrome.storage.local.get({ customProfanity: [] }, resolve);
        });

        const merged = [...new Set([...defaultList, ...data.customProfanity])];
        debugLog(`Loaded and merged ${merged.length} total profanity items.`);
        return merged;

    } catch (error) {
        console.error('[FFT-Content] Failed to load profanity list:', error);
        return [];
    }
}

/**
 * Splits the raw list into single words and multi-word phrases.
 */
function splitProfanityList(list) {
    const phrases = list.filter(w => w.trim().split(/\s+/).length > 1);
    const words = list.filter(w => w.trim().split(/\s+/).length === 1);
    debugLog(`Split profanity list: ${words.length} single words, ${phrases.length} phrases.`);
    return { phrases, words };
}

/**
 * Compiles the word list into a single global Regular Expression and prepares phrase objects.
 */
function compileRegexes() {
    // 1. Compile single word regex (uses word boundaries)
    if (singleWords.length) {
        const pattern = '\\b(' + singleWords.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b';
        wordRegex = new RegExp(pattern, 'gi');
        debugLog('Single Word Regex compiled.');
    } else {
        wordRegex = null;
    }

    // 2. Prepare phrase objects (regex for full phrase matching for censoring)
    phraseRegexes = phrases.map(phrase => ({
        phrase,
        // Match the full phrase anywhere (case-insensitive)
        regex: new RegExp('\\b' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi')
    }));
    debugLog(`Prepared ${phraseRegexes.length} phrase regexes.`);
}

// --- Video Mute Management (Live Caption Trigger) ---

/**
 * Toggles the video mute state for the MUTE_DURATION_MS (used for live caption trigger).
 */
function autoMuteVideo() {
    // Check if video is already muted or if the cooldown period has not passed
    if (isVideoMuted || (Date.now() - lastMuteTime < MUTE_COOLDOWN_MS)) {
        debugLog('Auto-mute skipped: Already muted or within cooldown period.');
        return;
    }

    const video = document.querySelector('video');
    if (!video) {
        debugLog('Mute failed: Video element not found.');
        return;
    }

    // If the mute schedule is active, do NOT trigger a caption-based mute
    if (isScheduledMuteActive(video.currentTime)) {
        debugLog('Auto-mute skipped: Schedule is already muting at this time.');
        return;
    }

    // Otherwise, allow caption-based mute
    video.muted = true;
    isVideoMuted = true;
    lastMuteTime = Date.now();

    debugLog(`Video Muted by profanity for ${MUTE_DURATION_MS / 1000} seconds.`);

    chrome.runtime.sendMessage({ type: 'MUTE_EVENT', status: 'MUTED' });

    setTimeout(() => {
        // Only unmute if we're not inside a scheduled mute window
        if (video.muted && !isScheduledMuteActive(video.currentTime)) {
            video.muted = false;
            isVideoMuted = false;
            debugLog('Video Unmuted after profanity timeout.');
            chrome.runtime.sendMessage({ type: 'MUTE_EVENT', status: 'UNMUTED' });
        } else {
            debugLog('Skipping profanity unmute: Scheduled mute is currently active.');
        }
    }, MUTE_DURATION_MS);
}

/**
 * Censors the text content, replacing profanity with 'cookies'.
 */
function censorCaptionText(text) {
    let censored = text;
    // Censor single words
    if (wordRegex) {
        censored = censored.replace(wordRegex, 'cookies');
    }
    // Censor full phrases
    for (const { regex } of phraseRegexes) {
        censored = censored.replace(regex, 'cookies');
    }
    return censored;
}

/**
 * Main processing function that checks, logs, and censors new caption text.
 */
function processCaptionNode(originalText, node) {
    const currentText = originalText.trim();

    if (currentText === lastProcessedCaption.trim()) {
        return; 
    }
    lastProcessedCaption = currentText;
    const video = document.querySelector('video');
    const isCurrentlyMuted = video ? video.muted : false;

    if (isCurrentlyMuted) {
        const censoredText = censorCaptionText(currentText);
        if (node.innerText.trim() !== censoredText.trim()) {
            node.innerText = censoredText;
            lastProcessedCaption = censoredText.trim(); 
            debugLog(`Censored muted caption: "${currentText}" -> "${censoredText}"`);
        }
        return;
    }
    
    let muteTriggered = false;

    // 1. Check for single word profanity
    if (wordRegex && wordRegex.test(currentText)) {
        debugLog(`SINGLE WORD PROFANITY DETECTED: "${currentText}"`);
        muteTriggered = true;
    }

    // 2. Check for full phrase match only (disable first two words logic)
    if (!muteTriggered && phrases.length > 0) {
        for (const phrase of phrases) {
            // Only trigger mute if the full phrase is present in the caption
            if (currentText.toLowerCase().includes(phrase.toLowerCase())) {
                debugLog(`FULL PHRASE PROFANITY DETECTED: "${phrase}" in "${currentText}"`);
                muteTriggered = true;
                break;
            }
        }
    }

    if (muteTriggered) {
        autoMuteVideo();
    }

    const censoredText = censorCaptionText(currentText);
    if (node.innerText.trim() !== censoredText.trim()) {
        node.innerText = censoredText;
        lastProcessedCaption = censoredText.trim(); 
        debugLog(`Caption censored to: "${censoredText}"`);
    }
}

// --- Mute Schedule Integration ---

/**
 * Loads the mute schedule and associated URL from storage.
 */
function checkAndApplyMuteSchedule() {
    debugLog('Checking for mute schedule in storage...');
    chrome.storage.local.get(['muteSchedule', 'muteScheduleUrl'], data => {
        // Ensure the schedule is only loaded if it matches the current page's URL
        const currentBaseUrl = getBaseVideoUrl(location.href);
        if (data.muteScheduleUrl === currentBaseUrl) {
            muteSchedule = data.muteSchedule || [];
            muteScheduleUrl = data.muteScheduleUrl;
            debugLog(`Loaded mute schedule with ${muteSchedule.length} entries for current URL.`);
        } else {
            muteSchedule = [];
            muteScheduleUrl = "";
            debugLog('No matching mute schedule found for current URL. Current URL: ' + currentBaseUrl + ' vs Schedule URL: ' + data.muteScheduleUrl);
        }
    });
}

/**
 * Checks if the given time is within a scheduled mute window.
 * @param {number} currentTime - The current video time in seconds.
 * @returns {boolean} True if a scheduled mute is active.
 */
function isScheduledMuteActive(currentTime) {
    if (!muteSchedule.length) return false;
    // Check against all schedule entries
    for (const entry of muteSchedule) {
        if (currentTime >= entry.start && currentTime <= entry.end) {
            return true;
        }
    }
    return false;
}

/**
 * Periodically checks the video time and mutes/unmutes based on the schedule.
 */
function scheduleMuteChecker() {
    // Only proceed if there is a schedule and the current URL matches the schedule URL
    const video = document.querySelector('video');
    if (!video || !muteSchedule.length || getBaseVideoUrl(muteScheduleUrl) !== getBaseVideoUrl(location.href)) {
        return; 
    }
    
    const currentTime = video.currentTime;
    const shouldBeMuted = isScheduledMuteActive(currentTime);

    if (shouldBeMuted && !video.muted) {
        // Mute the video
        video.muted = true;
        // isVideoMuted state is primarily for live caption logic, 
        // but we ensure the video.muted state is respected
        isVideoMuted = true; 
        debugLog(`Video Muted by SCHEDULE at ${currentTime.toFixed(2)}s.`);
        chrome.runtime.sendMessage({ type: 'MUTE_EVENT', status: 'MUTED' });
    } else if (!shouldBeMuted && video.muted && Date.now() - lastMuteTime > MUTE_DURATION_MS) {
        // Unmute only if not muted by a recent profanity trigger
        video.muted = false;
        isVideoMuted = false;
        debugLog(`Video Unmuted by SCHEDULE/Profanity Cooldown at ${currentTime.toFixed(2)}s.`);
        chrome.runtime.sendMessage({ type: 'MUTE_EVENT', status: 'UNMUTED' });
    }
}

// --- Observer & Initialization Logic ---

/**
 * Sets up a MutationObserver to watch for caption changes (more efficient than polling).
 */
function setupCaptionObserver() {
    if (observer) observer.disconnect();
    
    // Find caption container - targeting common modern and legacy selectors
    const captionContainer = document.querySelector('.ytp-caption-window-container, .captions-display-panel');
    
    if (!captionContainer) {
        debugLog('Caption container not found. Retrying in 2 seconds.');
        setTimeout(setupCaptionObserver, 2000);
        return;
    }

    debugLog('Caption container found. Setting up MutationObserver.');

    observer = new MutationObserver(mutations => {
        try {
            mutations.forEach(mutation => {
                const node = mutation.target;

                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(addedNode => {
                        if (addedNode.nodeType === 1) { // Element Node
                            const textNode = addedNode.querySelector('.ytp-caption-segment') || addedNode; 
                            if (textNode.innerText) {
                                processCaptionNode(textNode.innerText, textNode);
                            }
                        } else if (addedNode.nodeType === 3 && addedNode.parentElement) { // Text Node
                            processCaptionNode(addedNode.parentElement.innerText, addedNode.parentElement);
                        }
                    });
                }
                else if (mutation.type === 'characterData') {
                    if (node.parentElement && node.parentElement.innerText) {
                        processCaptionNode(node.parentElement.innerText, node.parentElement);
                    }
                }
            });
        } catch (e) {
            console.error('[FFT-Content] MutationObserver Error:', e);
            initializeFiltering(); // Re-initialize to handle unexpected DOM changes
        }
    });

    observer.observe(captionContainer, { 
        childList: true, 
        subtree: true, 
        characterData: true 
    });
    
    lastProcessedCaption = "";
    debugLog('MutationObserver started on caption container.');
}

function initializeFiltering() {
    debugLog('Filtering initialized/re-initialized.');
    
    // Load and check for a pre-saved mute schedule for the current URL
    checkAndApplyMuteSchedule(); 

    // Start watching for captions
    setupCaptionObserver();
}

// --- Main Execution Block ---
(async function() {
    debugLog('Script execution started.');
    
    // 1. Load, Split, and Compile Regex
    const fullList = await loadProfanityList();
    const split = splitProfanityList(fullList);
    singleWords = split.words;
    phrases = split.phrases;
    compileRegexes();

    // 2. Set up observer for caption elements and load mute schedule
    initializeFiltering(); 

    // 3. Listen for YouTube navigation (SPA) to re-initialize
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            debugLog('URL change detected. Re-initializing filtering.');
            // Disconnect old caption observer before re-initializing
            if (observer) observer.disconnect();
            initializeFiltering();
        }
    });
    urlObserver.observe(document.body, { subtree: true, childList: true });
    debugLog('URL change observer initialized.');

    // 4. Listen for mute toggle from popup
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'TOGGLE_MUTE') {
            const video = document.querySelector('video');
            if (video) {
                video.muted = !video.muted;
                debugLog(`Popup toggled video mute state to: ${video.muted}`);
                isVideoMuted = video.muted; 
            }
            sendResponse({ muted: video ? video.muted : false });
        }
    });
    debugLog('Runtime message listener (TOGGLE_MUTE) initialized.');

    // 5. Listen for changes to the mute schedule in storage (from popup)
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.muteSchedule || changes.muteScheduleUrl)) {
            debugLog('Storage change detected (muteSchedule). Re-checking schedule.');
            // Re-check and apply the schedule when storage changes
            checkAndApplyMuteSchedule(); 
        }
    });

    // 6. Start the periodic checker for the timed mute schedule
    setInterval(scheduleMuteChecker, SCHEDULE_CHECK_INTERVAL_MS);
    debugLog(`Periodic schedule mute checker started (interval: ${SCHEDULE_CHECK_INTERVAL_MS}ms).`);

})();