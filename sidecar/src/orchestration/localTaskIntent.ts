import { isPathInsideWorkspace, resolveTargetFolderReference, type ResolvedFolderReference, type SystemFolderResolutionOptions } from '../system/wellKnownFolders';
import { selectLocalWorkflow, type HostAccessOperation } from './localWorkflowRegistry';

export type LocalTaskIntent =
    | 'organize_files'
    | 'move_files'
    | 'rename_files'
    | 'delete_files'
    | 'inspect_folder'
    | 'deduplicate_files'
    | 'unknown';

export type LocalTaskPlanHint = {
    intent: LocalTaskIntent;
    targetFolder?: ResolvedFolderReference;
    fileKinds: string[];
    traversalScope: 'top_level' | 'recursive';
    preferredTools: string[];
    preferredWorkflow?: string;
    requiredAccess: HostAccessOperation[];
    requiresHostAccessGrant: boolean;
};

type AnalyzeLocalTaskIntentInput = SystemFolderResolutionOptions & {
    text: string;
    workspacePath: string;
};

function detectIntent(text: string): LocalTaskIntent {
    if (/(去重|重复文件|dedup|deduplicate)/i.test(text)) {
        return 'deduplicate_files';
    }
    if (/(重命名|rename)/i.test(text)) {
        return 'rename_files';
    }
    if (/(删除|清理|remove|delete)/i.test(text)) {
        return 'delete_files';
    }
    if (/(移动|挪到|移到|搬到|move)/i.test(text)) {
        return 'move_files';
    }
    if (/(查看|看看|扫描|列出|inspect|scan|list)/i.test(text)) {
        return 'inspect_folder';
    }
    if (/(整理|分类|归档|organize|sort|arrange|group)/i.test(text)) {
        return 'organize_files';
    }
    return 'unknown';
}

function detectFileKinds(text: string): string[] {
    const kinds: string[] = [];

    if (/(图片|照片|截图|image|images|photo|photos|png|jpe?g|gif|webp|heic|svg)/i.test(text)) {
        kinds.push('images');
    }
    if (/(视频|影片|movie|movies|video|videos|mp4|mov|avi|mkv)/i.test(text)) {
        kinds.push('videos');
    }
    if (/(文档|document|documents|pdf|docx?|xlsx?|pptx?)/i.test(text)) {
        kinds.push('documents');
    }

    return kinds;
}

function detectTraversalScope(text: string): 'top_level' | 'recursive' {
    if (/(递归|所有子目录|所有子文件夹|全部子目录|全部子文件夹|包含子目录|包含子文件夹|整个目录|整个文件夹|所有文件|recursive|recursively|subfolders?|entire folder|whole folder|all files)/i.test(text)) {
        return 'recursive';
    }

    return 'top_level';
}

function inferPreferredTools(intent: LocalTaskIntent): string[] {
    switch (intent) {
        case 'inspect_folder':
            return ['list_dir'];
        case 'organize_files':
            return ['list_dir', 'create_directory', 'batch_move_files'];
        case 'move_files':
            return ['list_dir', 'move_file', 'batch_move_files'];
        case 'rename_files':
            return ['move_file'];
        case 'delete_files':
            return ['list_dir', 'delete_path', 'batch_delete_paths'];
        case 'deduplicate_files':
            return ['list_dir', 'compute_file_hash', 'create_directory', 'batch_move_files'];
        default:
            return [];
    }
}

function inferRequiredAccess(intent: LocalTaskIntent): HostAccessOperation[] {
    switch (intent) {
        case 'inspect_folder':
            return ['read'];
        case 'organize_files':
        case 'move_files':
        case 'rename_files':
        case 'deduplicate_files':
            return ['read', 'write', 'move'];
        case 'delete_files':
            return ['read', 'delete'];
        default:
            return [];
    }
}

export function analyzeLocalTaskIntent(input: AnalyzeLocalTaskIntentInput): LocalTaskPlanHint | undefined {
    const targetFolder = resolveTargetFolderReference(input.text, input);
    const intent = detectIntent(input.text);
    const fileKinds = detectFileKinds(input.text);
    const traversalScope = detectTraversalScope(input.text);

    if (!targetFolder && intent === 'unknown') {
        return undefined;
    }

    const preferredTools = inferPreferredTools(intent);
    const workflow = selectLocalWorkflow({
        intent,
        folderId: targetFolder?.kind === 'well_known_folder' ? targetFolder.folderId : undefined,
        fileKinds,
    });
    const preferredWorkflow = workflow?.id;
    const requiredAccess = workflow?.requiredAccess ?? inferRequiredAccess(intent);
    const requiresHostAccessGrant = targetFolder
        ? !isPathInsideWorkspace(targetFolder.resolvedPath, input.workspacePath)
        : false;

    return {
        intent,
        targetFolder: targetFolder ?? undefined,
        fileKinds,
        traversalScope,
        preferredTools,
        preferredWorkflow,
        requiredAccess,
        requiresHostAccessGrant,
    };
}
