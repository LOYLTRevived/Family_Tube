/**
 * Family-Friendly Tube - content.js
 * Injects into YouTube pages to filter, censor, and mute video based on live captions.
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

// Constants (from previous request)
const MUTE_DURATION_MS = 500; // Mute for 0.5 seconds
const MUTE_COOLDOWN_MS = 0; // Minimum time between auto-mutes (0ms = no cooldown)

function debugLog(message, ...optionalParams) {
    // console.log(`[FFT-Content] ${message}`, ...optionalParams);
}

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


/**
 * Toggles the video mute state for the MUTE_DURATION_MS.
 */
function autoMuteVideo() {
    // Check if video is already muted or if the cooldown period has not passed
    if (isVideoMuted || (Date.now() - lastMuteTime < MUTE_COOLDOWN_MS)) {
        debugLog('Auto-mute skipped: Already muted or within cooldown period.');
        return;
    }

    const video = document.querySelector('video');
    if (video) {
        video.muted = true;
        isVideoMuted = true;
        lastMuteTime = Date.now();
        
        debugLog(`Video Muted for ${MUTE_DURATION_MS / 1000} seconds.`);

        // Notify background script (for popup status update)
        chrome.runtime.sendMessage({ type: 'MUTE_EVENT', status: 'MUTED' });

        setTimeout(() => {
            if (video.muted) {
                 video.muted = false;
            }
            isVideoMuted = false;
            debugLog('Video Unmuted.');
            chrome.runtime.sendMessage({ type: 'MUTE_EVENT', status: 'UNMUTED' });
        }, MUTE_DURATION_MS);
    } else {
        debugLog('Mute failed: Video element not found.');
    }
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

    // Optimization: Skip if the text hasn't changed substantially
    if (currentText === lastProcessedCaption.trim()) {
        return; 
    }
    
    // Update the last processed caption text
    lastProcessedCaption = currentText;
    
    if (isVideoMuted) {
        // Still need to censor even if muted
        const censoredText = censorCaptionText(currentText);
        if (node.innerText.trim() !== censoredText.trim()) {
            node.innerText = censoredText;
            lastProcessedCaption = censoredText.trim(); 
        }
        return;
    }
    
    let muteTriggered = false;

    // 1. Check for single word profanity
    if (wordRegex && wordRegex.test(currentText)) {
        debugLog(`SINGLE WORD PROFANITY DETECTED: "${currentText}"`);
        muteTriggered = true;
    }

    // 2. Check for phrase start (first 2 words)
    if (!muteTriggered && phrases.length > 0) {
        for (const phrase of phrases) {
            const phraseWords = phrase.trim().split(/\s+/).filter(w => w.length > 0);
            
            // Only check phrases that are 2 words or longer
            if (phraseWords.length >= 2) {
                const firstTwoWords = phraseWords.slice(0, 2).join(' ');
                
                // Use startsWith for fragmented caption text
                if (currentText.toLowerCase().startsWith(firstTwoWords.toLowerCase())) {
                    debugLog(`PHRASE START TRIGGERED (First 2 words of "${phrase}"): "${currentText}"`);
                    muteTriggered = true;
                    break; // Found a trigger, stop checking phrases
                }
            }
        }
    }

    if (muteTriggered) {
        autoMuteVideo();
    }

    // Censor the text in the DOM
    const censoredText = censorCaptionText(currentText);
    if (node.innerText.trim() !== censoredText.trim()) {
        node.innerText = censoredText;
        lastProcessedCaption = censoredText.trim(); 
        debugLog(`Caption censored to: "${censoredText}"`);
    }
}

/**
 * Sets up a MutationObserver to watch for caption changes (more efficient than polling).
 */
function setupCaptionObserver() {
    if (observer) observer.disconnect();
    
    const captionContainer = document.querySelector('.captions-display-panel, .ytp-caption-window-container');
    
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
}

function initializeFiltering() {
    debugLog('Filtering initialized/re-initialized.');
    setupCaptionObserver();
}

// --- Main Execution Block ---
(async function() {
    // 1. Load, Split, and Compile Regex
    const fullList = await loadProfanityList();
    const split = splitProfanityList(fullList);
    singleWords = split.words;
    phrases = split.phrases;
    compileRegexes();

    // 2. Set up observer for caption elements
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
})();
