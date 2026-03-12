#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
from pathlib import Path

TARGET_FILES = [
    'src/shopgoodwillClient.ts',
    'src/server.ts',
    'src/sniperEngine.ts',
    'src/sessionStore.ts',
    'src/tokenManager.ts',
    'src/config.ts',
    'src/types.ts',
    'public/index.html',
    'public/app.js',
    'README.md'
]


def run(*cmd: str) -> str:
    return subprocess.check_output(cmd, text=True).strip()


def ref_exists(ref: str) -> bool:
    return subprocess.run(['git', 'rev-parse', '--verify', '--quiet', ref], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def main() -> int:
    parser = argparse.ArgumentParser(description='Deep compare and generate hard-locked patch artifacts.')
    parser.add_argument('--main-ref', default='main')
    parser.add_argument('--codex-ref', default='codex/fix-404-error-and-implement-snipe-workflow')
    parser.add_argument('--fallback-main-ref', default='cffa083')
    parser.add_argument('--fallback-codex-ref', default='HEAD')
    parser.add_argument('--out-dir', default='artifacts/reconcile-codex-integrity')
    args = parser.parse_args()

    main_ref = args.main_ref if ref_exists(args.main_ref) else args.fallback_main_ref
    codex_ref = args.codex_ref if ref_exists(args.codex_ref) else args.fallback_codex_ref

    if not ref_exists(main_ref) or not ref_exists(codex_ref):
        print('Failed to resolve refs for comparison.', file=sys.stderr)
        return 2

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    diff_cmd = ['git', 'diff', '--binary', f'{main_ref}..{codex_ref}', '--', *TARGET_FILES]
    diff_text = subprocess.check_output(diff_cmd, text=True)
    (out_dir / 'codex-enhancements.patch').write_text(diff_text)

    summary = run('git', 'diff', '--stat', f'{main_ref}..{codex_ref}', '--', *TARGET_FILES)
    (out_dir / 'diff.stat.txt').write_text(summary + '\n')

    auth_diff = run('git', 'diff', f'{main_ref}..{codex_ref}', '--', 'src/shopgoodwillClient.ts')
    routes_diff = run('git', 'diff', f'{main_ref}..{codex_ref}', '--', 'src/server.ts')
    workflow_diff = run('git', 'diff', f'{main_ref}..{codex_ref}', '--', 'src/sniperEngine.ts')
    (out_dir / 'auth.diff.txt').write_text(auth_diff + '\n')
    (out_dir / 'routes.diff.txt').write_text(routes_diff + '\n')
    (out_dir / 'workflow.diff.txt').write_text(workflow_diff + '\n')

    current_config = Path('src/config.ts').read_text()
    switch_present = 'loginPersistenceConfirmationSwitch' in current_config

    metadata = {
        'resolved_refs': {'main': main_ref, 'codex': codex_ref},
        'target_files': TARGET_FILES,
        'confirmation_switch_present': switch_present,
        'state_check_markers': [
            'row.status !== confirmed guard',
            'sessionForRow requires connected token',
            'Date.now() >= endTime guard',
            'maxBid > currentPrice validation'
        ]
    }
    (out_dir / 'lock.json').write_text(json.dumps(metadata, indent=2) + '\n')

    print(f'[x] main ref: {main_ref}')
    print(f'[x] codex ref: {codex_ref}')
    print(f'[x] patch: {out_dir / "codex-enhancements.patch"}')
    print(f"[{'x' if switch_present else ' '}] CONFIRMATION SWITCH (login persistence)")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
