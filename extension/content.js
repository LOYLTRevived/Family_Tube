/**
 * Family-Friendly Tube - content.js
 * Injects into YouTube pages to filter, censor, and mute video based on live captions,
 * and also applies a pre-defined timed mute schedule.
 *
 * Behavior changes:
 * - Both auto-caption detection and timed mute schedule can mute the video together.
 * - The video only unmutes when BOTH systems are clear.
 * - Captions are always censored (including custom words from storage) by replacing matches with "cookies".
 */

let singleWords = [];
let phrases = [];
let wordRegex = null;
let phraseRegexes = [];
let observer = null;
let isVideoMuted = false;            // reflects "video.muted" state when we set it
let lastMuteTime = 0;
let lastProcessedCaption = "";

let muteSchedule = [];
let muteScheduleUrl = "";

// Two independent mute flags:
// - captionMuteActive: set when auto-caption detection finds profanity; cleared after MUTE_DURATION_MS
// - scheduleMuteActive: set when a scheduled mute window is active; cleared when out of scheduled window
let captionMuteActive = false;
let scheduleMuteActive = false;

let overlayTimeout = null;

const MUTE_DURATION_MS = 500;
const MUTE_COOLDOWN_MS = 0;
const SCHEDULE_CHECK_INTERVAL_MS = 200;

function debugLog(message, ...optionalParams) {
    console.log(`[FFT-Content] ${message}`, ...optionalParams);
}

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

/* ---------- Profanity list loading & reactive compile ---------- */

/**
 * Loads the default profanity list from the extension bundle
 * and merges it with user-defined words stored in chrome.storage.local.customProfanity.
 * Returns an array of strings.
 */
async function loadProfanityList() {
    debugLog('Attempting to load and merge profanity lists...');
    try {
        const url = chrome.runtime.getURL('utils/profanity_list.json');
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const defaultList = await response.json();

        const storageData = await new Promise(resolve => {
            chrome.storage.local.get({ customProfanity: [] }, resolve);
        });

        const merged = [...new Set([...defaultList, ...(storageData.customProfanity || [])])];
        debugLog(`Loaded and merged ${merged.length} total profanity items.`);
        return merged;
    } catch (error) {
        console.error('[FFT-Content] Failed to load profanity list:', error);
        return [];
    }
}

/**
 * Splits loadProfanityList array into single words and phrases
 */
function splitProfanityList(list) {
    const phrases = list.filter(w => w.trim().split(/\s+/).length > 1);
    const words = list.filter(w => w.trim().split(/\s+/).length === 1);
    debugLog(`Split profanity list: ${words.length} single words, ${phrases.length} phrases.`);
    return { phrases, words };
}

/**
 * Compiles regexes from the global singleWords & phrases arrays.
 * Must be run after updating singleWords/phrases.
 */
function compileRegexes() {
    if (singleWords.length) {
        const pattern = '\\b(' + singleWords.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b';
        wordRegex = new RegExp(pattern, 'gi');
        debugLog('Single Word Regex compiled.');
    } else {
        wordRegex = null;
    }

    phraseRegexes = phrases.map(phrase => ({
        phrase,
        regex: new RegExp('\\b' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi')
    }));
    debugLog(`Prepared ${phraseRegexes.length} phrase regexes.`);
}

/**
 * Refresh the profanity list from disk + storage and recompile regexes.
 */
async function refreshProfanity() {
    const fullList = await loadProfanityList();
    const split = splitProfanityList(fullList);
    singleWords = split.words;
    phrases = split.phrases;
    compileRegexes();
}

/* ---------- Muting coordination helpers ---------- */

/**
 * Set or clear a mute reason. The video is muted if ANY reason is active.
 * Reasons: 'caption' or 'schedule' (or any custom string).
 *
 * If setting caption mute, this function does NOT automatically clear it: caption mute clearing is handled
 * by the autoMute flow (timeout after MUTE_DURATION_MS) which calls setMuteReason(false,'caption').
 *
 * Logging calls are preserved/kept as in your original code.
 */
function setMuteReason(active, reason) {
    // reason should be 'caption' or 'schedule'
    if (reason === 'caption') {
        captionMuteActive = !!active;
    } else if (reason === 'schedule') {
        scheduleMuteActive = !!active;
    } else {
        // allow other reasons later
        if (active) {
            // treat other reasons as schedule-like
            scheduleMuteActive = true;
        } else {
            scheduleMuteActive = false;
        }
    }

    // Determine desired overall mute state
    const desiredMuted = captionMuteActive || scheduleMuteActive;

    const video = document.querySelector('video');
    if (!video) return;

    // If desiredMuted is true and video isn't muted, mute and log
    if (desiredMuted && !video.muted) {
        video.muted = true;
        isVideoMuted = true;
        lastMuteTime = Date.now(); // track when mute was applied
        // Preserve existing logs: determine which reason triggered (prefer caption)
        if (captionMuteActive && reason === 'caption') {
            debugLog(`Video Muted by profanity for ${MUTE_DURATION_MS / 1000}s.`);
            chrome.runtime.sendMessage({ type: 'MUTE_EVENT', status: 'MUTED' });
        } else if (scheduleMuteActive && reason === 'schedule') {
            debugLog(`Video Muted by SCHEDULE at ${video.currentTime.toFixed(2)}s.`);
            chrome.runtime.sendMessage({ type: 'MUTE_EVENT', status: 'MUTED' });
        } else {
            // Generic mute event
            debugLog(`Video Muted (combined) at ${video.currentTime ? video.currentTime.toFixed(2) : '0.00'}s.`);
            chrome.runtime.sendMessage({ type: 'MUTE_EVENT', status: 'MUTED' });
        }
    }

    // If desiredMuted is false and video is muted, attempt to unmute (respecting cooldown)
    if (!desiredMuted && video.muted) {
        // Ensure a minimal cooldown since last mute to prevent rapid toggle
        if (Date.now() - lastMuteTime > MUTE_DURATION_MS) {
            video.muted = false;
            isVideoMuted = false;
            // Preserve existing unmute logs: if previously schedule cleared, log schedule/unmute; otherwise caption/unmute
            debugLog(`Video Unmuted by SCHEDULE/Profanity Cooldown at ${video.currentTime ? video.currentTime.toFixed(2) : '0.00'}s.`);
            chrome.runtime.sendMessage({ type: 'MUTE_EVENT', status: 'UNMUTED' });
        } else {
            // still in cooldown: do nothing, unmute will happen after cooldown when setMuteReason is called again
            debugLog('Unmute delayed due to cooldown.');
        }
    }
}

/* ---------- Caption censoring & processing ---------- */

/**
 * Always censor text using compiled regexes (single words and phrases).
 * Replaces every match with 'cookies'.
 */
function censorCaptionText(text) {
    let censored = text;
    if (wordRegex) censored = censored.replace(wordRegex, 'cookies');
    for (const { regex } of phraseRegexes) {
        censored = censored.replace(regex, 'cookies');
    }
    return censored;
}

/**
 * Process each caption node: log always, detect profanity (trigger caption mute), censor text,
 * and update the DOM node if changed.
 */
function processCaptionNode(originalText, node) {
    const currentText = originalText ? originalText.trim() : '';
    if (!currentText) return;

    // Always log the caption text
    debugLog(`Caption detected: "${currentText}"`);

    // We keep duplicate suppression for DOM modifications to avoid thrash,
    // but we still log every caption. (lastProcessedCaption tracks what's in DOM)
    if (currentText === lastProcessedCaption.trim()) {
        // Still attempt to ensure the DOM contains the censored version (in case it was changed elsewhere)
        const censoredCheck = censorCaptionText(currentText);
        if (node.innerText.trim() !== censoredCheck.trim()) {
            node.innerText = censoredCheck;
            lastProcessedCaption = censoredCheck.trim();
            debugLog(`Caption censored to: "${censoredCheck}"`);
        }
        return;
    }

    // Update lastProcessedCaption to the raw text for change detection:
    lastProcessedCaption = currentText;

    const video = document.querySelector('video');
    const isCurrentlyMuted = video ? video.muted : false;

    // Profanity detection:
    let muteTriggered = false;

    // Single-word profanity
    if (wordRegex && wordRegex.test(currentText)) {
        debugLog(`SINGLE WORD PROFANITY DETECTED: "${currentText}"`);
        muteTriggered = true;
    }

    // Full-phrase profanity
    if (!muteTriggered && phrases.length > 0) {
        for (const phrase of phrases) {
            if (currentText.toLowerCase().includes(phrase.toLowerCase())) {
                debugLog(`FULL PHRASE PROFANITY DETECTED: "${phrase}" in "${currentText}"`);
                muteTriggered = true;
                break;
            }
        }
    }

    // If profanity detected, set caption mute flag (captionMuteActive) and schedule clearing after MUTE_DURATION_MS
    if (muteTriggered) {
        // If already caption-muted, do not re-run timeout; reset the lastMuteTime to keep cooldown consistent
        if (captionMuteActive) {
            lastMuteTime = Date.now();
        } else {
            captionMuteActive = true;
            lastMuteTime = Date.now();
            // This will apply mute via setMuteReason (logs preserved)
            setMuteReason(true, 'caption');

            // Clear caption mute after the duration — when cleared we call setMuteReason(false,'caption') to attempt unmute
            setTimeout(() => {
                captionMuteActive = false;
                setMuteReason(false, 'caption');
            }, MUTE_DURATION_MS);
        }
    }

    // Always censor the caption text and write back if changed
    const censoredText = censorCaptionText(currentText);
    if (node.innerText.trim() !== censoredText.trim()) {
        node.innerText = censoredText;
        lastProcessedCaption = censoredText.trim();
        debugLog(`Caption censored to: "${censoredText}"`);
    }
}

/* ---------- Mute schedule integration ---------- */

function checkAndApplyMuteSchedule() {
    debugLog('Checking for mute schedule in storage...');
    
    // 1. Determine the Video ID and the dynamic storage key name
    const currentBaseUrl = getBaseVideoUrl(location.href);
    const videoIdMatch = currentBaseUrl.match(/[?&]v=([^&]+)/); 
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    if (!videoId) {
        debugLog('Could not extract Video ID from current URL. Aborting schedule check.');
        return;
    }

    const scheduleKey = `schedule_${videoId}`; 
    
    // Request the dynamic schedule key
    chrome.storage.local.get([scheduleKey], data => {
        
        // --- 2. DEBUGGING LOGS ---
        debugLog(`Current URL (Normalized, being searched for): ${currentBaseUrl}`);
        debugLog(`Schedule Key Searched in Storage: ${scheduleKey}`);
        
        const scheduleContainer = data[scheduleKey]; // This is the object: { schedule: [..], url: "..." }

        // We must check if the container exists AND if the nested 'schedule' array exists and has length.
        if (scheduleContainer && Array.isArray(scheduleContainer.schedule) && scheduleContainer.schedule.length > 0) {
            
            // CORRECT: We extract the actual array from the container object.
            const storedScheduleArray = scheduleContainer.schedule; 

            // Success path:
            muteSchedule = storedScheduleArray;
            muteScheduleUrl = scheduleContainer.url || currentBaseUrl;
            
            debugLog(`✅ Loaded mute schedule with ${muteSchedule.length} entries for URL: ${muteScheduleUrl}`);
            
            // Crucial: Forces immediate check against the newly loaded schedule
            setMuteReason(false, 'schedule'); 
            
        } else {
            // Failure path:
            muteSchedule = [];
            muteScheduleUrl = "";
            debugLog(`❌ No matching schedule data found under key: ${scheduleKey}.`);
        }
    });
}

function isScheduledMuteActive(currentTime) {
    if (!muteSchedule.length) return false;
    return muteSchedule.some(entry => currentTime >= entry.start && currentTime <= entry.end);
}

/**
 * Periodically check whether schedule should be active and set/clear schedule mute flag.
 * Uses setMuteReason to coordinate with caption mute.
 */
function scheduleMuteChecker() {
    const video = document.querySelector('video');
    if (!video || !muteSchedule.length || getBaseVideoUrl(muteScheduleUrl) !== getBaseVideoUrl(location.href)) {
        // if no schedule, ensure schedule flag is cleared
        if (scheduleMuteActive) {
            scheduleMuteActive = false;
            setMuteReason(false, 'schedule');
        }
        return;
    }

    const currentTime = video.currentTime;
    const shouldBeMuted = isScheduledMuteActive(currentTime);

    if (shouldBeMuted && !scheduleMuteActive) {
        // Enter schedule mute
        scheduleMuteActive = true;
        setMuteReason(true, 'schedule');
    } else if (!shouldBeMuted && scheduleMuteActive) {
        // Exit schedule mute
        scheduleMuteActive = false;
        setMuteReason(false, 'schedule');
    }
}

/* ---------- MutationObserver & initialization ---------- */

function setupCaptionObserver() {
    if (observer) observer.disconnect();

    // Broadened selector and fallback logic to account for different YouTube DOM structures
    let captionContainer = document.querySelector('.ytp-caption-window-container, .captions-display-panel, .ytp-caption-segment-container, ytd-player');

    // If still not found, fallback to scanning for any element that contains a .ytp-caption-segment element
    if (!captionContainer) {
        const seg = document.querySelector('.ytp-caption-segment');
        if (seg && seg.parentElement) captionContainer = seg.parentElement;
    }

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
                        if (addedNode.nodeType === 1) {
                            const textNode = addedNode.querySelector('.ytp-caption-segment') || addedNode;
                            if (textNode && textNode.innerText) processCaptionNode(textNode.innerText, textNode);
                        } else if (addedNode.nodeType === 3 && addedNode.parentElement) {
                            processCaptionNode(addedNode.parentElement.innerText, addedNode.parentElement);
                        }
                    });
                } else if (mutation.type === 'characterData') {
                    if (node.parentElement && node.parentElement.innerText) {
                        processCaptionNode(node.parentElement.innerText, node.parentElement);
                    }
                }
            });
        } catch (e) {
            console.error('[FFT-Content] MutationObserver Error:', e);
            initializeFiltering(); // Attempt to recover
        }
    });

    observer.observe(captionContainer, { childList: true, subtree: true, characterData: true });
    lastProcessedCaption = "";
    debugLog('MutationObserver started on caption container.');
}

/**
 * Initialize filtering: refresh profanity, load schedule, and setup observer.
 */
async function initializeFiltering() {
    debugLog('Filtering initialized/re-initialized.');
    await refreshProfanity();
    checkAndApplyMuteSchedule();
    setupCaptionObserver();
}

/* ---------- Main Execution Block ---------- */
(async function() {
    debugLog('Script execution started.');

    // initial setup
    await refreshProfanity();
    initializeFiltering();

    // Watch for SPA navigation and re-initialize on change
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            debugLog('URL change detected. Re-initializing filtering.');
            if (observer) observer.disconnect();
            initializeFiltering();
        }
    });
    urlObserver.observe(document.body, { subtree: true, childList: true });
    debugLog('URL change observer initialized.');

    // Listen for popup toggle (manual mute)
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'TOGGLE_MUTE') {
            const video = document.querySelector('video');
            if (video) {
                video.muted = !video.muted;
                debugLog(`Popup toggled video mute state to: ${video.muted}`);
                isVideoMuted = video.muted;
                // If user manually unmutes while schedule/caption flags still active, our coordinated flags remain —
                // we attempt to respect user toggle but setMuteReason will re-mute if flags are active.
                // To keep it simple: if user toggles, clear both reason flags if unmuting manually.
                if (!video.muted) {
                    captionMuteActive = false;
                    scheduleMuteActive = false;
                    setMuteReason(false, 'caption');
                    setMuteReason(false, 'schedule');
                }
            }
            sendResponse({ muted: video ? video.muted : false });
        }
    });
    debugLog('Runtime message listener (TOGGLE_MUTE) initialized.');

    // React to storage changes: mute schedule and custom profanity
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            if (changes.muteSchedule || changes.muteScheduleUrl) {
                debugLog('Storage change detected (muteSchedule). Re-checking schedule.');
                checkAndApplyMuteSchedule();
            }
            if (changes.customProfanity) {
                debugLog('Storage change detected (customProfanity). Recompiling profanity list.');
                refreshProfanity();
            }
        }
    });

    // Start schedule checker
    setInterval(scheduleMuteChecker, SCHEDULE_CHECK_INTERVAL_MS);
    debugLog(`Periodic schedule mute checker started (interval: ${SCHEDULE_CHECK_INTERVAL_MS}ms).`);
})();