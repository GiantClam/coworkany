import { spawnSync } from 'node:child_process';
import process from 'node:process';

const OPENAI_COMPATIBLE_PRESETS = new Set([
  'openai',
  'aiberm',
  'nvidia',
  'siliconflow',
  'gemini',
  'qwen',
  'minimax',
  'kimi',
]);

function env(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function resolveProvider() {
  return env('COWORKANY_ANALYZER_SMOKE_PROVIDER');
}

function validateLiveSmokeEnvironment() {
  const provider = resolveProvider();
  const issues = [];

  if (!provider) {
    return {
      ok: true,
      provider: null,
      issues: [],
      note: 'No analyzer smoke override env is set. The desktop test will use the active provider/model from local CoworkAny settings.',
    };
  }

  const hasGenericKey = Boolean(env('COWORKANY_ANALYZER_SMOKE_API_KEY'));
  const hasAnthropicKey = Boolean(env('ANTHROPIC_API_KEY') || env('CLAUDE_API_KEY'));
  const hasOpenRouterKey = Boolean(env('OPENROUTER_API_KEY'));
  const hasOpenAIKey = Boolean(env('OPENAI_API_KEY'));
  const hasModel = Boolean(env('COWORKANY_ANALYZER_SMOKE_MODEL'));
  const hasBaseUrl = Boolean(env('COWORKANY_ANALYZER_SMOKE_BASE_URL'));

  if (provider === 'anthropic') {
    if (!(hasGenericKey || hasAnthropicKey)) {
      issues.push('Provide COWORKANY_ANALYZER_SMOKE_API_KEY, ANTHROPIC_API_KEY, or CLAUDE_API_KEY for anthropic smoke runs.');
    }
  } else if (provider === 'openrouter') {
    if (!(hasGenericKey || hasOpenRouterKey)) {
      issues.push('Provide COWORKANY_ANALYZER_SMOKE_API_KEY or OPENROUTER_API_KEY for openrouter smoke runs.');
    }
  } else if (provider === 'custom') {
    if (!(hasGenericKey || hasOpenAIKey)) {
      issues.push('Provide COWORKANY_ANALYZER_SMOKE_API_KEY or OPENAI_API_KEY for custom smoke runs.');
    }
    if (!hasModel) {
      issues.push('COWORKANY_ANALYZER_SMOKE_MODEL is required for custom smoke runs.');
    }
    if (!hasBaseUrl) {
      issues.push('COWORKANY_ANALYZER_SMOKE_BASE_URL is required for custom smoke runs.');
    }
  } else if (provider === 'ollama') {
    // No API key required.
  } else if (OPENAI_COMPATIBLE_PRESETS.has(provider)) {
    if (!(hasGenericKey || hasOpenAIKey)) {
      issues.push(`Provide COWORKANY_ANALYZER_SMOKE_API_KEY or OPENAI_API_KEY for ${provider} smoke runs.`);
    }
  } else {
    issues.push(`Unsupported analyzer smoke provider: ${provider}`);
  }

  return {
    ok: issues.length === 0,
    provider,
    issues,
    note: undefined,
  };
}

function printPreflight(result) {
  if (!result.provider) {
    console.log('[analyzer-live-smoke] No override provider configured.');
  } else {
    console.log(`[analyzer-live-smoke] Provider: ${result.provider}`);
  }

  if (result.ok) {
    console.log('[analyzer-live-smoke] Environment preflight passed.');
    if (result.note) {
      console.log(`[analyzer-live-smoke] ${result.note}`);
    }
    return;
  }

  console.error('[analyzer-live-smoke] Environment preflight failed:');
  for (const issue of result.issues) {
    console.error(`- ${issue}`);
  }
}

function main() {
  const preflightOnly = process.argv.includes('--preflight-only');
  const result = validateLiveSmokeEnvironment();
  printPreflight(result);

  if (!result.ok) {
    process.exit(1);
  }

  if (preflightOnly) {
    return;
  }

  const child = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'playwright',
      'test',
      'tests/analyzer-live-smoke-desktop-e2e.test.ts',
      '--reporter=line,html',
    ],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        COWORKANY_ANALYZER_SMOKE_RUN: process.env.COWORKANY_ANALYZER_SMOKE_RUN || '1',
      },
    }
  );

  if (typeof child.status === 'number') {
    process.exit(child.status);
  }

  process.exit(1);
}

main();
