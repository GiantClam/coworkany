/**
 * Bridges Module Exports
 *
 * IPC bridges between Sidecar and Tauri.
 */

export {
    PolicyBridge,
    createStdioPolicyBridge,
    createFilesystemWriteRequest,
    createShellWriteRequest,
    type PolicyBridgeConfig,
    type ConfirmationResult,
} from './policyBridge';
