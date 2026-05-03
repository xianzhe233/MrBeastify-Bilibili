import { chromium } from "playwright";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = repoRoot;
const browserPath = process.env.BROWSER_PATH || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "mrbeastify-bilibili-"));
const artifactsDir = path.join(repoRoot, "test-artifacts");

const pages = [
    {
        name: "home",
        url: "https://www.bilibili.com/",
        clickChangeButton: true
    },
    {
        name: "search",
        url: "https://search.bilibili.com/all?keyword=AI",
        scroll: true
    },
    {
        name: "video",
        url: "https://www.bilibili.com/video/BV1hV9aBGEgi",
        scroll: true
    }
];

await mkdir(artifactsDir, { recursive: true });

async function getExtensionIdFromOverlay(page) {
    const overlaySource = await page.locator("[data-mrbeastify-bilibili-overlay]").first().getAttribute("src");
    const match = overlaySource?.match(/^chrome-extension:\/\/([^/]+)\//);
    if (!match) {
        throw new Error("Could not find loaded extension ID from an overlay image URL");
    }

    return match[1];
}

async function getExtensionStorage(extensionPage) {
    return extensionPage.evaluate(() => new Promise((resolve) => {
        chrome.storage.local.get({
            extensionIsDisabled: false,
            appearChance: 1.00,
            flipChance: 0.25
        }, resolve);
    }));
}

const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: browserPath,
    headless: false,
    viewport: {
        width: 1440,
        height: 1000
    },
    args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--no-default-browser-check"
    ]
});

const failures = [];
const consoleMessages = [];
const page = context.pages()[0] || await context.newPage();

page.on("console", (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
});

page.on("pageerror", (error) => {
    consoleMessages.push(`pageerror: ${error.stack || error.message}`);
});

try {
    for (const target of pages) {
        await page.goto(target.url, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await page.waitForFunction(
            () => document.querySelectorAll("[data-mrbeastify-bilibili-overlay]").length > 0,
            { timeout: 20000 }
        ).catch(() => {});

        const firstOverlayCount = await page.locator("[data-mrbeastify-bilibili-overlay]").count();
        const firstProcessedCount = await page.locator("[data-mrbeastify-bilibili-processed]").count();

        await page.waitForTimeout(3500);

        const secondOverlayCount = await page.locator("[data-mrbeastify-bilibili-overlay]").count();
        const secondProcessedCount = await page.locator("[data-mrbeastify-bilibili-processed]").count();
        const allowedGrowth = Math.max(5, Math.ceil(Math.max(firstOverlayCount, 1) * 0.25));

        let dynamicOverlayCount = secondOverlayCount;
        if (target.scroll) {
            await page.mouse.wheel(0, 1400);
            await page.waitForTimeout(2500);
            dynamicOverlayCount = await page.locator("[data-mrbeastify-bilibili-overlay]").count();
        }

        if (target.clickChangeButton) {
            const changeButton = page.locator("button:has-text('换一换')").last();
            const changed = await changeButton.click({ timeout: 5000 }).then(() => true).catch(() => false);
            if (changed) {
                await page.waitForTimeout(2500);
                dynamicOverlayCount = await page.locator("[data-mrbeastify-bilibili-overlay]").count();
            }
        }

        let carouselStats = null;
        if (target.name === "home") {
            carouselStats = await page.evaluate(() => ({
                itemOverlays: document.querySelectorAll(".recommended-swipe .carousel-item [data-mrbeastify-bilibili-overlay]").length,
                rootOverlays: document.querySelectorAll(".recommended-swipe .carousel > [data-mrbeastify-bilibili-overlay]").length,
                processedItems: document.querySelectorAll(".recommended-swipe .carousel-item img[data-mrbeastify-bilibili-processed]").length
            }));
        }

        await page.screenshot({
            path: path.join(artifactsDir, `${target.name}.png`),
            fullPage: false
        });

        console.log(
            `${target.name}: overlays ${firstOverlayCount} -> ${secondOverlayCount}, ` +
            `dynamic ${dynamicOverlayCount}, processed ${firstProcessedCount} -> ${secondProcessedCount}`
        );

        if (carouselStats) {
            console.log(
                `home carousel: itemOverlays=${carouselStats.itemOverlays}, ` +
                `rootOverlays=${carouselStats.rootOverlays}, processedItems=${carouselStats.processedItems}`
            );
        }

        if (firstOverlayCount < 1) {
            failures.push(`${target.name}: no overlays found`);
        }

        if (secondOverlayCount > firstOverlayCount + allowedGrowth) {
            failures.push(`${target.name}: overlay count grew too much after observer fallback`);
        }

        if (dynamicOverlayCount < 1) {
            failures.push(`${target.name}: dynamic action left no overlays`);
        }

        if (carouselStats?.rootOverlays > 0) {
            failures.push("home carousel: overlays are attached to the root carousel instead of individual slides");
        }

        if (carouselStats && carouselStats.itemOverlays < 2) {
            failures.push("home carousel: fewer than two slide-specific overlays found");
        }
    }

    const extensionId = await getExtensionIdFromOverlay(page);
    const settingsPage = await context.newPage();
    await settingsPage.goto(`chrome-extension://${extensionId}/settings.html`);
    await settingsPage.waitForSelector("#appearChance", { timeout: 10000 });

    await settingsPage.evaluate(() => {
        const enabled = document.getElementById("disableExtension");
        const appearChance = document.getElementById("appearChance");
        const flipChance = document.getElementById("flipChance");

        enabled.checked = false;
        appearChance.value = "0";
        flipChance.value = "100";

        enabled.dispatchEvent(new Event("input", { bubbles: true }));
        appearChance.dispatchEvent(new Event("input", { bubbles: true }));
        flipChance.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await settingsPage.waitForTimeout(500);
    const storedSettings = await getExtensionStorage(settingsPage);
    console.log(
        `settings: disabled=${storedSettings.extensionIsDisabled}, ` +
        `appear=${storedSettings.appearChance}, flip=${storedSettings.flipChance}`
    );

    if (storedSettings.extensionIsDisabled !== true) {
        failures.push("settings: disabling the extension did not persist");
    }

    if (storedSettings.appearChance !== 0) {
        failures.push("settings: appear chance 0 did not persist");
    }

    if (storedSettings.flipChance !== 1) {
        failures.push("settings: flip chance 100 did not persist");
    }

    await page.goto("https://www.bilibili.com/", {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });
    await page.waitForTimeout(4000);

    const disabledOverlayCount = await page.locator("[data-mrbeastify-bilibili-overlay]").count();
    console.log(`disabled home: overlays ${disabledOverlayCount}`);

    if (disabledOverlayCount !== 0) {
        failures.push("settings: disabled extension still added overlays after reload");
    }
} finally {
    await context.close();
    await rm(userDataDir, {
        force: true,
        recursive: true
    });
}

const relevantErrors = consoleMessages.filter((message) => (
    message.includes("Bilibili MrBeastify") ||
    message.includes("chrome-extension://")
));

if (relevantErrors.length > 0) {
    console.log("\nRelevant console messages:");
    relevantErrors.forEach((message) => console.log(`- ${message}`));
}

if (failures.length > 0) {
    console.error("\nSmoke test failures:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
}

console.log("\nSmoke test passed.");
