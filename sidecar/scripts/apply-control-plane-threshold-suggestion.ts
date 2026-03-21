import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    applyControlPlaneThresholdUpdateSuggestion,
    loadControlPlaneThresholdUpdateSuggestion,
} from '../src/release/readiness';

type CliOptions = {
    suggestionPath: string;
    configPath?: string;
    outputPath?: string;
    writeInPlace: boolean;
};

function resolveDefaultThresholdConfigPath(): string {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(scriptDir, '..', 'evals', 'control-plane', 'readiness-thresholds.json');
}

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {
        suggestionPath: '',
        configPath: undefined,
        outputPath: undefined,
        writeInPlace: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case '--suggestion':
                options.suggestionPath = path.resolve(argv[index + 1]);
                index += 1;
                break;
            case '--config':
                options.configPath = path.resolve(argv[index + 1]);
                index += 1;
                break;
            case '--out':
                options.outputPath = path.resolve(argv[index + 1]);
                index += 1;
                break;
            case '--write':
                options.writeInPlace = true;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!options.suggestionPath) {
        throw new Error('Missing required argument: --suggestion <path>');
    }

    return options;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const suggestion = loadControlPlaneThresholdUpdateSuggestion(options.suggestionPath);
    const configPath = options.configPath
        ?? (suggestion.sourcePath ? path.resolve(suggestion.sourcePath) : resolveDefaultThresholdConfigPath());
    const updatedConfig = applyControlPlaneThresholdUpdateSuggestion(
        JSON.parse(fs.readFileSync(configPath, 'utf-8')),
        suggestion,
    );
    const rendered = `${JSON.stringify(updatedConfig, null, 2)}\n`;

    if (options.writeInPlace && options.outputPath) {
        throw new Error('Use either --write or --out, not both.');
    }

    if (options.writeInPlace) {
        fs.writeFileSync(configPath, rendered, 'utf-8');
        console.log(`Updated control-plane thresholds in ${configPath}`);
        return;
    }

    if (options.outputPath) {
        fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
        fs.writeFileSync(options.outputPath, rendered, 'utf-8');
        console.log(`Wrote updated control-plane thresholds to ${options.outputPath}`);
        return;
    }

    process.stdout.write(rendered);
}

main().catch((error) => {
    console.error('[apply-control-plane-threshold-suggestion] fatal:', error);
    process.exitCode = 1;
});
