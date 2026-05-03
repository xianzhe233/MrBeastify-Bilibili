const IMAGES_PATH = "images/";
const EXTENSION_NAME = chrome.runtime.getManifest().name;
const PROCESSED_ATTR = "data-mrbeastify-bilibili-processed";
const CONTAINER_ATTR = "data-mrbeastify-bilibili-container";
const OVERLAY_ATTR = "data-mrbeastify-bilibili-overlay";
const OWNED_POSITION_ATTR = "data-mrbeastify-bilibili-position";
const SCHEDULE_DELAY_MS = 120;
const FALLBACK_SCAN_MS = 3000;

let useAlternativeImages = false;
let flipBlacklist = [];
let alternativeImageSet = new Set();
let blacklistStatus = "No flip blacklist loaded yet.";

let extensionIsDisabled = false;
let appearChance = 1.00;
let flipChance = 0.25;

let highestImageIndex = 0;
let scheduledScan = null;
let observer = null;
let fallbackInterval = null;
let currentURL = location.href;

const explicitImageSelectors = [
    ".bili-video-card__image--wrap img",
    ".bili-video-card__cover img",
    ".bili-video-card img",
    ".feed-card img",
    ".recommend-list-v1 img",
    ".video-page-card-small img",
    ".video-card-ad-small img",
    ".video-awesome-img img.b-img__inner",
    ".pic-box img.b-img__inner",
    ".cover img.b-img__inner",
    ".b-img img.b-img__inner",
    ".carousel-item img",
    ".carousel-inner__img img",
    ".carousel-area-img img",
    ".banner-img img",
    ".carousel img",
    "img[src*='bfs/archive']",
    "img[src*='bfs/sycp']",
    "img[src*='bfs/banner']",
    "img[src*='bfs/live-key-frame']",
    "img[src*='archive.biliimg.com']"
];

const coverContainerSelectors = [
    ".bili-video-card__image--wrap",
    ".bili-video-card__cover",
    ".video-awesome-img",
    ".pic-box",
    ".cover",
    ".carousel-item",
    ".carousel-area-img",
    ".banner-img",
    ".b-img",
    "a"
];

const excludedContainers = [
    ".bili-avatar",
    ".avatar",
    ".face",
    ".user-avatar",
    ".v-avatar",
    ".up-avatar",
    ".login-panel",
    ".mini-avatar",
    ".bili-header .inner-logo",
    ".logo",
    ".logo-img",
    ".bili-video-card__info",
    ".bili-video-card__info--owner",
    ".bili-video-card__stats",
    ".status-1",
    ".nav-user-center",
    ".right-entry",
    ".header-avatar-wrap"
];

function clampChance(value, fallback) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return fallback;
    }

    return Math.max(0, Math.min(1, numericValue));
}

function getStorage(defaults) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(defaults, (result) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
            }

            resolve(result);
        });
    });
}

async function loadConfig() {
    const defaults = {
        extensionIsDisabled: false,
        appearChance: 1.00,
        flipChance: 0.25
    };

    try {
        const config = await getStorage(defaults);
        extensionIsDisabled = Boolean(config.extensionIsDisabled);
        appearChance = clampChance(config.appearChance, defaults.appearChance);
        flipChance = clampChance(config.flipChance, defaults.flipChance);
    } catch (error) {
        console.error(`${EXTENSION_NAME}: Error loading configuration.`, error);
    }
}

function getImageURL(imagePath) {
    const path = String(imagePath).endsWith(".png") ? String(imagePath) : `${imagePath}.png`;
    return chrome.runtime.getURL(`${IMAGES_PATH}${path}`);
}

async function imagePathExists(imagePath) {
    try {
        const response = await fetch(getImageURL(imagePath), { method: "HEAD" });
        return response.ok;
    } catch (error) {
        return false;
    }
}

const sizeOfNonRepeat = 8;
const lastIndexes = Array(sizeOfNonRepeat).fill(-1);

function getRandomImageFromDirectory() {
    if (highestImageIndex < 1) {
        return null;
    }

    if (highestImageIndex <= sizeOfNonRepeat) {
        lastIndexes.fill(-1);
    }

    let randomIndex = -1;
    while (lastIndexes.includes(randomIndex) || randomIndex < 0) {
        randomIndex = Math.floor(Math.random() * highestImageIndex) + 1;
    }

    lastIndexes.shift();
    lastIndexes.push(randomIndex);

    return randomIndex;
}

async function getHighestImageIndex() {
    const initialIndex = 4;
    let index = initialIndex;

    while (await imagePathExists(index)) {
        index *= 2;
    }

    let min = index <= initialIndex ? 1 : index / 2;
    let max = index;

    while (min <= max) {
        const mid = Math.floor((min + max) / 2);

        if (await imagePathExists(mid)) {
            min = mid + 1;
        } else {
            max = mid - 1;
        }
    }

    highestImageIndex = max;
}

async function getFlipBlocklist() {
    try {
        const response = await fetch(chrome.runtime.getURL(`${IMAGES_PATH}flip_blacklist.json`));
        const data = await response.json();

        useAlternativeImages = Boolean(data.useAlternativeImages);
        flipBlacklist = Array.isArray(data.blacklistedImages) ? data.blacklistedImages : [];
        alternativeImageSet = new Set();

        if (useAlternativeImages) {
            const checks = await Promise.all(
                flipBlacklist.map(async (imageIndex) => ({
                    imageIndex,
                    exists: await imagePathExists(`textFlipped/${imageIndex}`)
                }))
            );

            checks
                .filter((check) => check.exists)
                .forEach((check) => alternativeImageSet.add(check.imageIndex));
        }

        blacklistStatus = `Flip blacklist found. ${alternativeImageSet.size} alternative images available.`;
    } catch (error) {
        useAlternativeImages = false;
        flipBlacklist = [];
        alternativeImageSet = new Set();
        blacklistStatus = "No flip blacklist found. Proceeding without it.";
    }
}

function getImageSource(image) {
    return image.currentSrc || image.src || image.dataset.src || image.getAttribute("data-src") || "";
}

function getVisibleSize(image) {
    const rect = image.getBoundingClientRect();
    const width = rect.width || image.naturalWidth || image.width;
    const height = rect.height || image.naturalHeight || image.height;

    return { width, height };
}

function hasCoverAncestor(image) {
    return coverContainerSelectors.some((selector) => image.closest(selector));
}

function isInsideExcludedContainer(image) {
    if (hasCoverAncestor(image)) {
        return false;
    }

    return excludedContainers.some((selector) => image.closest(selector));
}

function hasExcludedClass(image) {
    const classes = [
        image.className,
        image.parentElement?.className,
        image.parentElement?.parentElement?.className
    ].join(" ");

    return /\b(avatar|face|logo|icon|emoji|badge|medal|vip|qrcode)\b/i.test(classes);
}

function isNonCoverSource(source) {
    return [
        "/bfs/face/",
        "/bfs/member/",
        "/bfs/garb/",
        "/bfs/vip/",
        "/favicon",
        "/live.gif",
        "/512.png",
        "static/jinkela/long/images/live.gif"
    ].some((token) => source.includes(token));
}

function sourceLooksLikeCover(source) {
    return [
        "/bfs/archive/",
        "/bfs/sycp/",
        "/bfs/banner/",
        "/bfs/live-key-frame/",
        "archive.biliimg.com/bfs/archive"
    ].some((token) => source.includes(token));
}

function linkLooksLikeMedia(image) {
    const link = image.closest("a[href]");
    if (!link) {
        return false;
    }

    const href = link.href || "";
    return /bilibili\.com\/(video|bangumi|blackboard|festival|cheese|read|list|v\/popular)|live\.bilibili\.com|cm\.bilibili\.com/.test(href);
}

function sizeLooksLikeCover(image) {
    const { width, height } = getVisibleSize(image);
    if (width < 80 || height < 45) {
        return false;
    }

    const ratio = width / height;
    if (!Number.isFinite(ratio)) {
        return false;
    }

    return ratio >= 1.2 && ratio <= 12;
}

function isAlreadyProcessed(image) {
    const container = getOverlayContainer(image);
    return image.hasAttribute(PROCESSED_ATTR) || Boolean(container?.querySelector(`[${OVERLAY_ATTR}]`));
}

function getOverlayContainer(image) {
    return coverContainerSelectors
        .map((selector) => image.closest(selector))
        .find((container) => container && container.contains(image)) || image.parentElement;
}

function isCandidateImage(image) {
    if (!(image instanceof HTMLImageElement) || !image.isConnected) {
        return false;
    }

    if (image.hasAttribute(OVERLAY_ATTR) || isAlreadyProcessed(image)) {
        return false;
    }

    const source = getImageSource(image);
    if (!source || isNonCoverSource(source)) {
        return false;
    }

    if (isInsideExcludedContainer(image) || hasExcludedClass(image)) {
        return false;
    }

    if (!sizeLooksLikeCover(image)) {
        return false;
    }

    return hasCoverAncestor(image) || sourceLooksLikeCover(source) || linkLooksLikeMedia(image);
}

function findThumbnails() {
    const images = new Set();

    explicitImageSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((image) => images.add(image));
    });

    return Array.from(images).filter(isCandidateImage);
}

function markProcessed(image, container) {
    image.setAttribute(PROCESSED_ATTR, "true");
    if (container) {
        container.setAttribute(CONTAINER_ATTR, "true");
    }
}

function applyOverlay(image, container, overlayImageURL, flip = false) {
    const previousPosition = getComputedStyle(container).position;
    if (previousPosition === "static") {
        container.style.position = "relative";
        container.setAttribute(OWNED_POSITION_ATTR, "true");
    }

    const overlayImage = document.createElement("img");
    overlayImage.alt = "";
    overlayImage.draggable = false;
    overlayImage.src = overlayImageURL;
    overlayImage.setAttribute(OVERLAY_ATTR, "true");
    overlayImage.style.position = "absolute";
    overlayImage.style.inset = "0";
    overlayImage.style.width = "100%";
    overlayImage.style.height = "100%";
    overlayImage.style.objectFit = "contain";
    overlayImage.style.pointerEvents = "none";
    overlayImage.style.transform = flip ? "scaleX(-1)" : "";
    overlayImage.style.zIndex = "1";

    container.appendChild(overlayImage);
}

function applyOverlayToImage(image) {
    const container = getOverlayContainer(image);
    if (!container) {
        return;
    }

    markProcessed(image, container);

    const loops = Math.random() > 0.001 ? 1 : 20;
    for (let i = 0; i < loops; i++) {
        let flip = Math.random() < flipChance;
        let baseImagePath = getRandomImageFromDirectory();
        if (baseImagePath === null) {
            return;
        }

        if (flip && flipBlacklist.includes(baseImagePath)) {
            if (useAlternativeImages && alternativeImageSet.has(baseImagePath)) {
                baseImagePath = `textFlipped/${baseImagePath}`;
                flip = false;
            } else {
                flip = false;
            }
        }

        if (Math.random() < appearChance) {
            applyOverlay(image, container, getImageURL(baseImagePath), flip);
        }
    }
}

function applyOverlayToThumbnails() {
    if (extensionIsDisabled) {
        return;
    }

    findThumbnails().forEach(applyOverlayToImage);
}

function cleanupOverlays() {
    document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((overlay) => overlay.remove());
    document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((image) => image.removeAttribute(PROCESSED_ATTR));
    document.querySelectorAll(`[${CONTAINER_ATTR}]`).forEach((container) => {
        container.removeAttribute(CONTAINER_ATTR);
        if (container.getAttribute(OWNED_POSITION_ATTR) === "true") {
            container.style.position = "";
            container.removeAttribute(OWNED_POSITION_ATTR);
        }
    });
}

function scheduleScan(delay = SCHEDULE_DELAY_MS) {
    if (extensionIsDisabled || scheduledScan !== null) {
        return;
    }

    scheduledScan = window.setTimeout(() => {
        scheduledScan = null;
        applyOverlayToThumbnails();
    }, delay);
}

function handlePossibleRouteChange() {
    if (currentURL !== location.href) {
        currentURL = location.href;
        scheduleScan(250);
    }
}

function startObservers() {
    if (observer) {
        observer.disconnect();
    }

    observer = new MutationObserver((mutations) => {
        const shouldScan = mutations.some((mutation) => (
            mutation.type === "childList" ||
            (mutation.type === "attributes" && ["src", "srcset", "class", "style"].includes(mutation.attributeName))
        ));

        if (shouldScan) {
            handlePossibleRouteChange();
            scheduleScan();
        }
    });

    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["src", "srcset", "class", "style"],
        childList: true,
        subtree: true
    });

    window.addEventListener("popstate", () => scheduleScan(250));

    if (fallbackInterval) {
        window.clearInterval(fallbackInterval);
    }

    fallbackInterval = window.setInterval(() => {
        handlePossibleRouteChange();
        scheduleScan(0);
    }, FALLBACK_SCAN_MS);
}

function listenForSettingsChanges() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") {
            return;
        }

        if (changes.extensionIsDisabled) {
            extensionIsDisabled = Boolean(changes.extensionIsDisabled.newValue);
        }

        if (changes.appearChance) {
            appearChance = clampChance(changes.appearChance.newValue, appearChance);
        }

        if (changes.flipChance) {
            flipChance = clampChance(changes.flipChance.newValue, flipChance);
        }

        if (extensionIsDisabled) {
            cleanupOverlays();
        } else {
            scheduleScan(0);
        }
    });
}

async function main() {
    await loadConfig();
    await getFlipBlocklist();
    await getHighestImageIndex();
    listenForSettingsChanges();

    if (extensionIsDisabled) {
        cleanupOverlays();
        console.info(`${EXTENSION_NAME} is disabled.`);
        return;
    }

    startObservers();
    scheduleScan(0);
    console.info(`${EXTENSION_NAME} loaded successfully. ${highestImageIndex} images detected. ${blacklistStatus}`);
}

main();
