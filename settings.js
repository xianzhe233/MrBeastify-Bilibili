const defaults = {
    extensionIsDisabled: false,
    appearChance: 1.00,
    flipChance: 0.25
};

function clampPercent(value, fallback) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return fallback;
    }

    return Math.max(0, Math.min(100, numericValue));
}

function loadSettings() {
    chrome.storage.local.get(defaults, (data) => {
        document.getElementById("disableExtension").checked = !data.extensionIsDisabled;
        document.getElementById("appearChance").value = Math.round(data.appearChance * 100);
        document.getElementById("flipChance").value = Math.round(data.flipChance * 100);
    });
}

function saveSettings() {
    const appearPercent = clampPercent(document.getElementById("appearChance").value, defaults.appearChance * 100);
    const flipPercent = clampPercent(document.getElementById("flipChance").value, defaults.flipChance * 100);

    chrome.storage.local.set({
        extensionIsDisabled: !document.getElementById("disableExtension").checked,
        appearChance: appearPercent / 100,
        flipChance: flipPercent / 100
    }, () => {
        if (chrome.runtime.lastError) {
            console.error("Error saving settings:", chrome.runtime.lastError);
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    document.getElementById("disableExtension").addEventListener("input", saveSettings);
    document.getElementById("appearChance").addEventListener("input", saveSettings);
    document.getElementById("flipChance").addEventListener("input", saveSettings);
});
