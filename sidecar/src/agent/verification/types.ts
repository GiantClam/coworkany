/**
 * Automatic Verification Types
 *
 * Types for verifying that operations completed successfully
 */

export type VerificationStatus = 'passed' | 'failed' | 'skipped' | 'unknown';

export interface VerificationResult {
    status: VerificationStatus;
    message: string;
    score: number; // 0-1, confidence in the result
    evidence: string[]; // Evidence supporting the verification
    suggestions: string[]; // Suggestions if verification failed
}

export interface VerificationStrategy {
    name: string;
    description: string;
    canVerify: (toolName: string, args: Record<string, unknown>, result: string) => boolean;
    verify: (toolName: string, args: Record<string, unknown>, result: string, context: VerificationContext) => Promise<VerificationResult>;
}

export interface VerificationContext {
    taskId: string;
    workspacePath: string;
    previousSteps: string[]; // History of what was done
}

export interface VerificationConfig {
    enabled: boolean;
    autoCorrect: boolean; // Automatically attempt corrections
    requiredConfidence: number; // 0-1, minimum confidence to pass
    maxRetries: number; // Maximum correction attempts
}

export const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
    enabled: true,
    autoCorrect: true,
    requiredConfidence: 0.7,
    maxRetries: 3,
};

/**
 * Common verification patterns
 */
export interface FileVerification {
    type: 'file_exists' | 'file_content' | 'file_syntax';
    filePath: string;
    expectedContent?: string;
    expectedPattern?: RegExp;
}

export interface CommandVerification {
    type: 'exit_code' | 'stdout_contains' | 'stderr_empty';
    expectedExitCode?: number;
    expectedOutput?: string;
}

export interface TestVerification {
    type: 'tests_pass' | 'coverage_threshold';
    testCommand?: string;
    coverageThreshold?: number;
}

export interface BuildVerification {
    type: 'build_success' | 'no_errors' | 'artifacts_generated';
    buildCommand?: string;
    expectedArtifacts?: string[];
}
