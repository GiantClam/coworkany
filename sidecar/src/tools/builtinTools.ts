import { voiceSpeakTool } from './core/voice';
import { recallTool, rememberTool } from './core/memoryTools';
import { runCommandTool } from './core/commandTool';
import {
    batchDeletePathsTool,
    batchMoveFilesTool,
    computeFileHashTool,
    createDirectoryTool,
    deletePathTool,
    listDirTool,
    moveFileTool,
    replaceFileContentTool,
    viewFileTool,
    writeToFileTool,
} from './core/fileTools';
import type { ToolDefinition } from './core/types';

export const COWORKANY_BUILTIN_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    listDirTool,
    viewFileTool,
    writeToFileTool,
    replaceFileContentTool,
    moveFileTool,
    deletePathTool,
    createDirectoryTool,
    computeFileHashTool,
    batchDeletePathsTool,
    batchMoveFilesTool,
    runCommandTool,
    rememberTool,
    recallTool,
    voiceSpeakTool,
];
