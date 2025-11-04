/**
 * Family-Friendly Tube - content.js
 * Filters YouTube captions for profanity and automatically mutes videos
 * either when bad words appear or during predefined mute schedule times.
 *
 * ✅ Both caption detection and timed schedule can mute together.
 * ✅ Video unmutes immediately when BOTH are clear.
 * ✅ All profanity (including custom words) replaced with "cookies" in captions.
 */

let singleWords = [];
let phrases = [];
let wordRegex = null;
let phraseRegexes = [];
let observer = null;

let captionMuteActive = false;
let scheduleMuteActive = false;
let isVideoMuted = false;

let muteSchedule = [];
let muteScheduleUrl = "";
let lastProcessedCaption = "";

const MUTE_DURATION_MS = 500;
const SCHEDULE_CHECK_INTERVAL_MS = 200;

/* ------------------- Utility ------------------- */

function debugLog(msg, ...params) {
  console.log(`[FFT-Content] ${msg}`, ...params);
}

function getBaseVideoUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") && u.searchParams.has("v"))
      return `https://www.youtube.com/watch?v=${u.searchParams.get("v")}`;
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

/* ------------------- Profanity Loading ------------------- */

async function loadProfanityList() {
  try {
    const response = await fetch(chrome.runtime.getURL("utils/profanity_list.json"));
    if (!response.ok) throw new Error("Failed to load default list");
    const defaultList = await response.json();

    const { customProfanity = [] } = await new Promise((resolve) =>
      chrome.storage.local.get({ customProfanity: [] }, resolve)
    );

    const merged = [...new Set([...defaultList, ...customProfanity])];
    debugLog(`Loaded ${merged.length} total profanity entries.`);
    return merged;
  } catch (e) {
    console.error("[FFT-Content] Profanity list error:", e);
    return [];
  }
}

function splitProfanityList(list) {
  const phrases = list.filter((w) => w.trim().split(/\s+/).length > 1);
  const words = list.filter((w) => w.trim().split(/\s+/).length === 1);
  return { phrases, words };
}

function compileRegexes() {
  if (singleWords.length) {
    const pattern =
      "\\b(" +
      singleWords.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
      ")\\b";
    wordRegex = new RegExp(pattern, "gi");
  } else wordRegex = null;

  phraseRegexes = phrases.map((phrase) => ({
    phrase,
    regex: new RegExp("\\b" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"),
  }));
}

async function refreshProfanity() {
  const fullList = await loadProfanityList();
  const split = splitProfanityList(fullList);
  singleWords = split.words;
  phrases = split.phrases;
  compileRegexes();
}

/* ------------------- Mute Coordination ------------------- */

function setMuteReason(active, reason) {
  if (reason === "caption") captionMuteActive = !!active;
  if (reason === "schedule") scheduleMuteActive = !!active;

  const video = document.querySelector("video");
  if (!video) return;

  const shouldMute = captionMuteActive || scheduleMuteActive;

  if (shouldMute && !video.muted) {
    video.muted = true;
    isVideoMuted = true;
    debugLog(`Video muted by ${reason}.`);
    chrome.runtime.sendMessage({ type: "MUTE_EVENT", status: "MUTED" });
  }

  if (!shouldMute && video.muted) {
    video.muted = false;
    isVideoMuted = false;
    debugLog("Video unmuted — all mute reasons cleared.");
    chrome.runtime.sendMessage({ type: "MUTE_EVENT", status: "UNMUTED" });
  }
}

/* ------------------- Caption Handling ------------------- */

function censorCaptionText(text) {
  let censored = text;
  if (wordRegex) censored = censored.replace(wordRegex, "cookies");
  for (const { regex } of phraseRegexes) censored = censored.replace(regex, "cookies");
  return censored;
}

function processCaptionNode(originalText, node) {
  const text = (originalText || "").trim();
  if (!text) return;

  debugLog(`Caption: "${text}"`);

  // Detect profanity
  let hasProfanity = false;
  if (wordRegex && wordRegex.test(text)) hasProfanity = true;
  if (!hasProfanity) {
    for (const p of phrases) {
      if (text.toLowerCase().includes(p.toLowerCase())) {
        hasProfanity = true;
        break;
      }
    }
  }

  if (hasProfanity) {
    debugLog("Profanity detected, muting.");
    setMuteReason(true, "caption");
    clearTimeout(node._captionUnmuteTimer);
    node._captionUnmuteTimer = setTimeout(
      () => setMuteReason(false, "caption"),
      MUTE_DURATION_MS
    );
  }

  // Apply censor
  const censored = censorCaptionText(text);
  if (node.innerText.trim() !== censored) node.innerText = censored;
  lastProcessedCaption = censored;
}

/* ------------------- Schedule Handling ------------------- */

function checkAndApplyMuteSchedule() {
  chrome.storage.local.get(["muteSchedule", "muteScheduleUrl"], (data) => {
    const currentUrl = getBaseVideoUrl(location.href);
    if (data.muteScheduleUrl === currentUrl) {
      muteSchedule = data.muteSchedule || [];
      muteScheduleUrl = data.muteScheduleUrl;
      debugLog(`Loaded ${muteSchedule.length} mute windows.`);
    } else {
      muteSchedule = [];
      muteScheduleUrl = "";
    }
  });
}

function isScheduledMuteActive(currentTime) {
  return muteSchedule.some((s) => currentTime >= s.start && currentTime <= s.end);
}

function scheduleMuteChecker() {
  const video = document.querySelector("video");
  if (!video || !muteSchedule.length) {
    if (scheduleMuteActive) setMuteReason(false, "schedule");
    return;
  }

  const active = isScheduledMuteActive(video.currentTime);
  if (active && !scheduleMuteActive) setMuteReason(true, "schedule");
  else if (!active && scheduleMuteActive) setMuteReason(false, "schedule");
}

/* ------------------- Caption Observation ------------------- */

function setupCaptionObserver() {
  if (observer) observer.disconnect();

  let container =
    document.querySelector(
      ".ytp-caption-window-container, .captions-display-panel, .ytp-caption-segment-container"
    ) || document.querySelector("ytd-player");

  if (!container) {
    setTimeout(setupCaptionObserver, 2000);
    return;
  }

  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) {
            const el = n.querySelector(".ytp-caption-segment") || n;
            if (el?.innerText) processCaptionNode(el.innerText, el);
          }
        });
      } else if (m.type === "characterData" && m.target.parentElement) {
        processCaptionNode(m.target.parentElement.innerText, m.target.parentElement);
      }
    }
  });

  observer.observe(container, { childList: true, subtree: true, characterData: true });
  debugLog("Caption observer active.");
}

/* ------------------- Initialization ------------------- */

async function initializeFiltering() {
  await refreshProfanity();
  checkAndApplyMuteSchedule();
  setupCaptionObserver();
}

(async function main() {
  debugLog("Family-Friendly Tube active.");

  await initializeFiltering();

  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      debugLog("URL change detected, reloading filters.");
      if (observer) observer.disconnect();
      initializeFiltering();
    }
  });
  urlObserver.observe(document.body, { subtree: true, childList: true });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "TOGGLE_MUTE") {
      const video = document.querySelector("video");
      if (!video) return;

      video.muted = !video.muted;
      isVideoMuted = video.muted;
      if (!video.muted) {
        captionMuteActive = false;
        scheduleMuteActive = false;
      }
      sendResponse({ muted: video.muted });
      debugLog(`Manual toggle: ${video.muted ? "MUTED" : "UNMUTED"}`);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.muteSchedule || changes.muteScheduleUrl) checkAndApplyMuteSchedule();
      if (changes.customProfanity) refreshProfanity();
    }
  });

  setInterval(scheduleMuteChecker, SCHEDULE_CHECK_INTERVAL_MS);
  debugLog("Schedule checker running.");
})();
