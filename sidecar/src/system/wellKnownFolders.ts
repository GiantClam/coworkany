import * as os from 'os';
import * as path from 'path';

export type WellKnownFolderId =
    | 'downloads'
    | 'desktop'
    | 'documents'
    | 'pictures'
    | 'movies'
    | 'music'
    | 'home';

export type SystemOs = 'macos' | 'windows' | 'linux';

export type WellKnownFolderReference = {
    kind: 'well_known_folder';
    folderId: WellKnownFolderId;
    sourcePhrase: string;
    resolvedPath: string;
    os: SystemOs;
    confidence: number;
};

export type ExplicitPathReference = {
    kind: 'explicit_path';
    sourcePhrase: string;
    resolvedPath: string;
    os: SystemOs;
    confidence: number;
};

export type ResolvedFolderReference = WellKnownFolderReference | ExplicitPathReference;

export type SystemFolderResolutionOptions = {
    homeDir?: string;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
};

type FolderPattern = {
    folderId: WellKnownFolderId;
    patterns: RegExp[];
};

const FOLDER_PATTERNS: FolderPattern[] = [
    {
        folderId: 'downloads',
        patterns: [
            /\bdownloads?\b/i,
            /下载(?:目录|文件夹)?/i,
        ],
    },
    {
        folderId: 'desktop',
        patterns: [
            /\bdesktop\b/i,
            /桌面/i,
        ],
    },
    {
        folderId: 'documents',
        patterns: [
            /\bdocuments?\b/i,
            /文档(?:目录|文件夹)?/i,
        ],
    },
    {
        folderId: 'pictures',
        patterns: [
            /\bpictures?\b/i,
            /\bphotos?\b/i,
            /图片(?:目录|文件夹)?/i,
            /照片(?:目录|文件夹)?/i,
        ],
    },
    {
        folderId: 'movies',
        patterns: [
            /\bmovies?\b/i,
            /\bvideos?\b/i,
            /视频(?:目录|文件夹)?/i,
            /影片(?:目录|文件夹)?/i,
        ],
    },
    {
        folderId: 'music',
        patterns: [
            /\bmusic\b/i,
            /音乐(?:目录|文件夹)?/i,
        ],
    },
    {
        folderId: 'home',
        patterns: [
            /\bhome\b/i,
            /\buser home\b/i,
            /主目录/i,
            /家目录/i,
        ],
    },
];

const EXPLICIT_PATH_PATTERNS: RegExp[] = [
    /(?:^|[\s"'`(])(~[\\/][^\s"'`，。；;！？!?()]+)/g,
    /(?:^|[\s"'`(])(\/(?:[^/\s"'`，。；;！？!?()]+\/?)+)/g,
    /(?:^|[\s"'`(])([A-Za-z]:[\\/][^\s"'`，。；;！？!?()]+(?:[\\/][^\s"'`，。；;！？!?()]+)*)/g,
];

function normalizePlatform(platform: NodeJS.Platform): SystemOs {
    if (platform === 'darwin') {
        return 'macos';
    }
    if (platform === 'win32') {
        return 'windows';
    }
    return 'linux';
}

function getPathModule(platform: NodeJS.Platform): typeof path.win32 | typeof path.posix {
    return platform === 'win32' ? path.win32 : path.posix;
}

export function resolveWellKnownFolderPath(
    folderId: WellKnownFolderId,
    options: SystemFolderResolutionOptions = {}
): string {
    const homeDir = options.homeDir ?? os.homedir();
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;

    if (platform === 'win32') {
        switch (folderId) {
            case 'downloads':
                return env.USERPROFILE ? path.join(env.USERPROFILE, 'Downloads') : path.join(homeDir, 'Downloads');
            case 'desktop':
                return env.USERPROFILE ? path.join(env.USERPROFILE, 'Desktop') : path.join(homeDir, 'Desktop');
            case 'documents':
                return env.USERPROFILE ? path.join(env.USERPROFILE, 'Documents') : path.join(homeDir, 'Documents');
            case 'pictures':
                return env.USERPROFILE ? path.join(env.USERPROFILE, 'Pictures') : path.join(homeDir, 'Pictures');
            case 'movies':
                return env.USERPROFILE ? path.join(env.USERPROFILE, 'Videos') : path.join(homeDir, 'Videos');
            case 'music':
                return env.USERPROFILE ? path.join(env.USERPROFILE, 'Music') : path.join(homeDir, 'Music');
            case 'home':
                return env.USERPROFILE || homeDir;
        }
    }

    switch (folderId) {
        case 'downloads':
            return path.join(homeDir, 'Downloads');
        case 'desktop':
            return path.join(homeDir, 'Desktop');
        case 'documents':
            return path.join(homeDir, 'Documents');
        case 'pictures':
            return path.join(homeDir, 'Pictures');
        case 'movies':
            return path.join(homeDir, 'Movies');
        case 'music':
            return path.join(homeDir, 'Music');
        case 'home':
            return homeDir;
    }
}

export function resolveWellKnownFolderReference(
    text: string,
    options: SystemFolderResolutionOptions = {}
): ResolvedFolderReference | null {
    for (const candidate of FOLDER_PATTERNS) {
        for (const pattern of candidate.patterns) {
            const match = text.match(pattern);
            if (!match) {
                continue;
            }

            return {
                kind: 'well_known_folder',
                folderId: candidate.folderId,
                sourcePhrase: match[0],
                resolvedPath: resolveWellKnownFolderPath(candidate.folderId, options),
                os: normalizePlatform(options.platform ?? process.platform),
                confidence: 0.98,
            };
        }
    }

    return null;
}

function normalizeExplicitPath(
    candidate: string,
    options: SystemFolderResolutionOptions = {}
): string | null {
    const platform = options.platform ?? process.platform;
    const homeDir = options.homeDir ?? os.homedir();
    const pathModule = getPathModule(platform);

    if (candidate.startsWith('~/') || candidate.startsWith('~\\')) {
        return pathModule.normalize(pathModule.resolve(homeDir, candidate.slice(2)));
    }

    if (platform === 'win32') {
        if (/^[A-Za-z]:[\\/]/.test(candidate)) {
            return path.win32.normalize(candidate);
        }
        return null;
    }

    if (candidate.startsWith('/') && !candidate.startsWith('//')) {
        return path.posix.normalize(candidate);
    }

    return null;
}

export function resolveExplicitPathReference(
    text: string,
    options: SystemFolderResolutionOptions = {}
): ExplicitPathReference | null {
    for (const pattern of EXPLICIT_PATH_PATTERNS) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
            const sourcePhrase = match[1]?.trim();
            if (!sourcePhrase) {
                continue;
            }

            const resolvedPath = normalizeExplicitPath(sourcePhrase, options);
            if (!resolvedPath) {
                continue;
            }

            return {
                kind: 'explicit_path',
                sourcePhrase,
                resolvedPath,
                os: normalizePlatform(options.platform ?? process.platform),
                confidence: 0.99,
            };
        }
    }

    return null;
}

export function resolveTargetFolderReference(
    text: string,
    options: SystemFolderResolutionOptions = {}
): ResolvedFolderReference | null {
    return resolveExplicitPathReference(text, options) ?? resolveWellKnownFolderReference(text, options);
}

export function isPathInsideWorkspace(targetPath: string, workspacePath: string): boolean {
    const relative = path.relative(path.resolve(workspacePath), path.resolve(targetPath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
