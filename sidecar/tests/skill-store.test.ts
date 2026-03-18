import { describe, expect, test } from 'bun:test';
import { SkillStore } from '../src/storage/skillStore';
import { inspectSkillDependencies } from '../src/claude_skills/dependencyInstaller';

describe('skill store parsing', () => {
    test('parses allowed tools and nested OpenClaw metadata from SKILL frontmatter', () => {
        const manifest = SkillStore.parseSkillMd(
            'demo-skill',
            '/tmp/demo-skill',
            `---
name: Demo Skill
version: 1.2.3
description: Demo
allowed-tools:
  - run_command
  - write_to_file
triggers:
  - build demo
metadata:
  openclaw:
    requires:
      bins:
        - uv
    install:
      uv:
        - demo-cli
---

# Demo
`
        );

        expect(manifest).not.toBeNull();
        expect(manifest?.allowedTools).toEqual(['run_command', 'write_to_file']);
        expect(manifest?.triggers).toEqual(['build demo']);
        expect(manifest?.metadata).toEqual({
            openclaw: {
                requires: {
                    bins: ['uv'],
                },
                install: {
                    uv: ['demo-cli'],
                },
            },
        });
    });

    test('dependency inspection surfaces auto-install commands from OpenClaw metadata', () => {
        const manifest = SkillStore.parseSkillMd(
            'demo-skill',
            '/tmp/demo-skill',
            `---
name: Demo Skill
version: 1.0.0
description: Demo
requires:
  bins:
    - definitely-missing-demo-binary
metadata:
  openclaw:
    install:
      uv:
        - definitely-missing-demo-binary
---
`
        );

        expect(manifest).not.toBeNull();
        const inspection = inspectSkillDependencies(manifest!);
        expect(inspection.satisfied).toBe(false);
        expect(inspection.canAutoInstall).toBe(true);
        expect(
            inspection.installCommands.some((command) =>
                command === 'uv pip install definitely-missing-demo-binary' ||
                command === 'pip install definitely-missing-demo-binary'
            )
        ).toBe(true);
    });

    test('dependency inspection surfaces download installer plans from OpenClaw metadata', () => {
        const manifest = SkillStore.parseSkillMd(
            'demo-skill',
            '/tmp/demo-skill',
            `---
name: Demo Skill
version: 1.0.0
description: Demo
requires:
  bins:
    - demo-binary
metadata:
  openclaw:
    install:
      download:
        url: https://example.com/demo-binary.zip
        extract: true
---
`
        );

        expect(manifest).not.toBeNull();
        const inspection = inspectSkillDependencies(manifest!);
        expect(inspection.satisfied).toBe(false);
        expect(inspection.canAutoInstall).toBe(true);
        expect(inspection.installPlans).toEqual([
            {
                kind: 'download',
                label: 'Download demo-binary installer',
                binary: 'demo-binary',
                url: 'https://example.com/demo-binary.zip',
                extract: true,
            },
        ]);
    });
});
