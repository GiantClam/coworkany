export * from '../../ops/controlPlaneEvalRunner';
import { runControlPlaneEvalRunnerCli } from '../../ops/controlPlaneEvalRunner';

const invokedAsScript = (process.argv[1] ?? '').endsWith('controlPlaneEvalRunner.ts');
if (invokedAsScript) {
    runControlPlaneEvalRunnerCli().catch((error) => {
        console.error('[control-plane-eval-runner] fatal:', error);
        process.exitCode = 1;
    });
}
