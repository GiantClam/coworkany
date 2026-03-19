import type { WellKnownFolderId } from '../system/wellKnownFolders';
import type { LocalTaskIntent } from './localTaskIntent';

export type HostAccessOperation = 'read' | 'write' | 'move' | 'delete';

export type LocalWorkflowStep = {
    tool: string;
    reasoning: string;
};

export type LocalWorkflow = {
    id: string;
    title: string;
    intent: LocalTaskIntent;
    folderIds?: WellKnownFolderId[];
    fileKinds?: string[];
    requiredAccess: HostAccessOperation[];
    steps: LocalWorkflowStep[];
};

const LOCAL_WORKFLOWS: LocalWorkflow[] = [
    {
        id: 'organize-downloads-images',
        title: 'Organize image files in Downloads',
        intent: 'organize_files',
        folderIds: ['downloads'],
        fileKinds: ['images'],
        requiredAccess: ['read', 'write', 'move'],
        steps: [
            {
                tool: 'list_dir',
                reasoning: 'Inspect the Downloads folder and enumerate candidate image files first.',
            },
            {
                tool: 'create_directory',
                reasoning: 'Create the destination subfolders before moving files.',
            },
            {
                tool: 'batch_move_files',
                reasoning: 'Move image files into deterministic subfolders using structured file operations.',
            },
            {
                tool: 'list_dir',
                reasoning: 'Re-scan the folder to verify the resulting structure and counts.',
            },
        ],
    },
    {
        id: 'inspect-downloads-images',
        title: 'Inspect image files in Downloads',
        intent: 'inspect_folder',
        folderIds: ['downloads'],
        fileKinds: ['images'],
        requiredAccess: ['read'],
        steps: [
            {
                tool: 'list_dir',
                reasoning: 'List the folder contents and filter image files before answering.',
            },
        ],
    },
    {
        id: 'deduplicate-downloads-images',
        title: 'Deduplicate image files in Downloads',
        intent: 'deduplicate_files',
        folderIds: ['downloads'],
        fileKinds: ['images'],
        requiredAccess: ['read', 'write', 'move'],
        steps: [
            {
                tool: 'list_dir',
                reasoning: 'Find candidate image files before checking duplicates.',
            },
            {
                tool: 'compute_file_hash',
                reasoning: 'Hash candidate image files so duplicates are detected by content instead of only by file name.',
            },
            {
                tool: 'create_directory',
                reasoning: 'Create the quarantine folder before moving duplicate copies out of the main folder.',
            },
            {
                tool: 'batch_move_files',
                reasoning: 'Quarantine duplicate copies using structured file moves while keeping one canonical copy in place.',
            },
            {
                tool: 'list_dir',
                reasoning: 'Verify duplicates were removed or quarantined as planned.',
            },
        ],
    },
    {
        id: 'organize-host-folder-files',
        title: 'Organize files in a host folder',
        intent: 'organize_files',
        requiredAccess: ['read', 'write', 'move'],
        steps: [
            {
                tool: 'list_dir',
                reasoning: 'Inspect the target host folder before changing anything.',
            },
            {
                tool: 'create_directory',
                reasoning: 'Create any required destination directories before moving files.',
            },
            {
                tool: 'batch_move_files',
                reasoning: 'Apply deterministic file moves with structured inputs instead of shell commands.',
            },
        ],
    },
    {
        id: 'inspect-host-folder',
        title: 'Inspect a host folder',
        intent: 'inspect_folder',
        requiredAccess: ['read'],
        steps: [
            {
                tool: 'list_dir',
                reasoning: 'List the target folder contents and summarize the findings.',
            },
        ],
    },
    {
        id: 'delete-host-folder-files',
        title: 'Delete files in a host folder',
        intent: 'delete_files',
        requiredAccess: ['read', 'delete'],
        steps: [
            {
                tool: 'list_dir',
                reasoning: 'Inspect and confirm the candidate files before deleting anything.',
            },
            {
                tool: 'batch_delete_paths',
                reasoning: 'Delete the selected files with structured file operations instead of shell commands.',
            },
            {
                tool: 'list_dir',
                reasoning: 'Re-scan the target folder to verify the deletion result.',
            },
        ],
    },
    {
        id: 'deduplicate-host-folder-files',
        title: 'Deduplicate files in a host folder',
        intent: 'deduplicate_files',
        requiredAccess: ['read', 'write', 'move'],
        steps: [
            {
                tool: 'list_dir',
                reasoning: 'Inspect the target host folder and collect candidate files before deduplication.',
            },
            {
                tool: 'compute_file_hash',
                reasoning: 'Hash candidate files so duplicates are detected by content instead of by name.',
            },
            {
                tool: 'create_directory',
                reasoning: 'Create the duplicate quarantine folder before moving redundant copies.',
            },
            {
                tool: 'batch_move_files',
                reasoning: 'Move duplicate copies into quarantine using structured file operations.',
            },
            {
                tool: 'list_dir',
                reasoning: 'Re-scan the target folder or quarantine folder to verify the deduplication result.',
            },
        ],
    },
];

export function selectLocalWorkflow(input: {
    intent: LocalTaskIntent;
    folderId?: WellKnownFolderId;
    fileKinds: string[];
}): LocalWorkflow | undefined {
    const exact = LOCAL_WORKFLOWS.find((workflow) => {
        if (workflow.intent !== input.intent) {
            return false;
        }

        const folderMatches = !workflow.folderIds || (input.folderId ? workflow.folderIds.includes(input.folderId) : false);
        const kindsMatch = !workflow.fileKinds || workflow.fileKinds.every((kind) => input.fileKinds.includes(kind));

        return folderMatches && kindsMatch;
    });

    if (exact) {
        return exact;
    }

    return LOCAL_WORKFLOWS.find((workflow) => workflow.intent === input.intent && !workflow.folderIds && !workflow.fileKinds);
}

export function formatWorkflowForPrompt(workflow: LocalWorkflow): string {
    const steps = workflow.steps
        .map((step, index) => `${index + 1}. ${step.tool}: ${step.reasoning}`)
        .join('\n');

    return `Workflow: ${workflow.title}
Workflow ID: ${workflow.id}
Required access: ${workflow.requiredAccess.join(', ')}
Deterministic steps:
${steps}`;
}
