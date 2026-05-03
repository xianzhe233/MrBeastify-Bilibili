import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(repoRoot, "dist");
const chromeEdgeDir = path.join(distDir, "chrome-edge");
const firefoxDir = path.join(distDir, "firefox");
const chromeEdgeZip = path.join(distDir, "bilibili-mrbeastify-chrome-edge.zip");
const firefoxZip = path.join(distDir, "bilibili-mrbeastify-firefox.zip");

const packageFiles = [
    "manifest.json",
    "mrbeastify.js",
    "settings.html",
    "settings.js",
    "icon.png",
    "LICENSE",
    "README.md",
    "PRIVACY.md"
];

async function copyPackageFiles(targetDir) {
    await mkdir(targetDir, { recursive: true });

    for (const file of packageFiles) {
        await cp(path.join(repoRoot, file), path.join(targetDir, file));
    }

    await cp(path.join(repoRoot, "images"), path.join(targetDir, "images"), {
        recursive: true
    });
}

async function zipDirectory(sourceDir, zipPath) {
    await rm(zipPath, { force: true });
    await execFileAsync("zip", ["-r", "-X", zipPath, "."], {
        cwd: sourceDir
    });
}

async function writeFirefoxManifest() {
    const manifestPath = path.join(firefoxDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    manifest.browser_specific_settings = {
        gecko: {
            id: "bilibili-mrbeastify@xianzhe233.github.io",
            strict_min_version: "140.0",
            data_collection_permissions: {
                required: ["none"]
            }
        },
        gecko_android: {
            strict_min_version: "142.0"
        }
    };

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await copyPackageFiles(chromeEdgeDir);
await copyPackageFiles(firefoxDir);
await writeFirefoxManifest();

await zipDirectory(chromeEdgeDir, chromeEdgeZip);
await zipDirectory(firefoxDir, firefoxZip);

console.log(`Chrome/Edge package: ${chromeEdgeZip}`);
console.log(`Firefox package: ${firefoxZip}`);
