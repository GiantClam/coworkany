/**
 * CoworkAny - Self-Learning Agent
 *
 * Main entry point for the self-learning system.
 * Enables AI to autonomously learn new capabilities from the internet.
 *
 * Architecture:
 *   GapDetector → ResearchEngine → LearningProcessor → LabSandbox → Precipitator
 *        ↑                                                              ↓
 *        └──────────────────── ReuseEngine ←────────────────────────────┘
 *                                   ↑
 *                           ConfidenceTracker
 */

// Types
export * from './types';

// Core modules
export { ConfidenceTracker, getConfidenceTracker, initConfidenceTracker } from './confidenceTracker';
export { GapDetector, createGapDetector } from './gapDetector';
export { ResearchEngine, createResearchEngine } from './researchEngine';
export { LearningProcessor, createLearningProcessor } from './learningProcessor';
export { LabSandbox, createLabSandbox } from './labSandbox';
export { Precipitator, createPrecipitator } from './precipitator';
export { ReuseEngine, createReuseEngine } from './reuseEngine';
export { SelfLearningController, createSelfLearningController } from './controller';

// OpenClaw-style enhancements
export { FeedbackManager, createFeedbackManager } from './feedbackManager';
export { SkillVersionManager, createVersionManager } from './versionManager';
export { ProactiveLearner, createProactiveLearner } from './proactiveLearner';

// Dependency management (composition-first approach)
export { DependencyResolver, createDependencyResolver } from './dependencyResolver';
export { SkillDependencyLoader, createSkillDependencyLoader } from './skillDependencyLoader';
export { DependencyValidator, createDependencyValidator } from './dependencyValidator';
