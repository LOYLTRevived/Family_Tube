/**
 * family-friendly-tube/watch_later_parser.js
 * Scrapes ALL videos from the target playlist URL, regardless of whether they have been watched.
 */

function parseTargetPlaylist() {
    console.log('[FFT-Parser] Starting target playlist scrape...');
    const allUrls = new Set();
    
    // Selector for all video items in the playlist
    const videoItems = document.querySelectorAll('ytd-playlist-video-renderer');

    videoItems.forEach(item => {
        // NOTE: The previous check for 'watchedProgress' is removed entirely
        // to allow processing of partially or fully watched videos.
        
        const anchor = item.querySelector('a#video-title');
        if (anchor && anchor.href) {
            // The URL is split to remove playlist context (&list=...)
            // which results in a clean video URL: https://www.youtube.com/watch?v=VIDEO_ID
            allUrls.add(anchor.href.split('&list=')[0]); 
        }
    });

    return Array.from(allUrls);
}

function sendUrlsToBackground() {
    const urls = parseTargetPlaylist();
    
    // Send the list of all video URLs back to the background script
    chrome.runtime.sendMessage({
        type: 'WATCH_LATER_URLS', // Message type remains the same
        urls: urls
    });
    
    console.log(`[FFT-Parser] Scraped and sent ${urls.length} total URLs.`);
}

// Wait a short delay for the dynamic YouTube page content to load before scraping
setTimeout(sendUrlsToBackground, 2000);