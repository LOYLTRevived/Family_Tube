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