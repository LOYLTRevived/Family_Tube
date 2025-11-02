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