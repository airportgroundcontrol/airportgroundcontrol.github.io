import fs from 'node:fs';
import path from 'node:path';

export const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4173';
export const browserChannel = process.env.BROWSER_CHANNEL || 'chrome';
export const artifactDirectory = path.resolve(process.env.ARTIFACT_DIR || 'test-results');
fs.mkdirSync(artifactDirectory, { recursive: true });
export const artifact = name => path.join(artifactDirectory, name);
