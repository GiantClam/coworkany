#!/usr/bin/env node

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

function usage() {
    console.log('Usage: node remove_similar_images.mjs <folder_path> [--delete] [--threshold N]');
}

function collectImages(folderPath) {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .sort()
        .map((name) => path.join(folderPath, name));
}

function hashFile(filePath) {
    const data = fs.readFileSync(filePath);
    return createHash('sha256').update(data).digest('hex');
}

function groupByHash(imagePaths) {
    const groups = new Map();
    for (const imagePath of imagePaths) {
        try {
            const hash = hashFile(imagePath);
            console.log(`OK hashed: ${path.basename(imagePath)}`);
            const bucket = groups.get(hash) ?? [];
            bucket.push(imagePath);
            groups.set(hash, bucket);
        } catch (error) {
            console.log(`ERR hash ${path.basename(imagePath)}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return [...groups.values()].filter((group) => group.length > 1);
}

function removeDuplicates(groups) {
    let removed = 0;
    for (const group of groups) {
        const [keep, ...dups] = group;
        console.log(`GROUP keep=${path.basename(keep)} total=${group.length}`);
        for (const dup of dups) {
            try {
                fs.unlinkSync(dup);
                removed += 1;
                console.log(`REMOVED ${path.basename(dup)}`);
            } catch (error) {
                console.log(`ERR remove ${path.basename(dup)}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    return removed;
}

function main() {
    if (process.argv.length < 3) {
        usage();
        return 1;
    }

    const folder = path.resolve(process.argv[2]);
    const doDelete = process.argv.includes('--delete');

    // Kept for compatibility with previous interface.
    // This script currently performs exact-content dedupe only.
    const thresholdIdx = process.argv.indexOf('--threshold');
    if (thresholdIdx >= 0 && thresholdIdx + 1 < process.argv.length) {
        const thresholdValue = Number.parseInt(process.argv[thresholdIdx + 1], 10);
        if (Number.isFinite(thresholdValue)) {
            void thresholdValue;
        }
    }

    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        console.log(`ERR folder not found: ${folder}`);
        return 1;
    }

    const images = collectImages(folder);
    console.log(`IMAGES_FOUND=${images.length}`);
    if (images.length === 0) {
        return 0;
    }

    const groups = groupByHash(images);
    console.log(`SIMILAR_GROUPS=${groups.length}`);
    if (groups.length === 0) {
        console.log(`DEDUPE_DONE removed=0 remaining=${images.length}`);
        return 0;
    }

    if (!doDelete) {
        const toRemove = groups.reduce((sum, group) => sum + Math.max(0, group.length - 1), 0);
        console.log(`PREVIEW_ONLY to_remove=${toRemove}`);
        return 0;
    }

    const removed = removeDuplicates(groups);
    const remaining = collectImages(folder).length;
    console.log(`DEDUPE_DONE removed=${removed} remaining=${remaining}`);
    return 0;
}

process.exitCode = main();
