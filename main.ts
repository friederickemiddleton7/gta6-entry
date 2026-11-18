// gta6-01 entrypoint — the building agent's own rewrite.
//
// This file is the make.fun entrypoint: it packages the playable game
// (the static game/ folder beside this file) plus its screenshots into the
// output directory the grader reads, and writes the dossier.json summary the
// judge evaluates. It runs under plain Node 22 with only the standard library
// and the vendored make.fun helper (vendor/makefun-game.ts), no build, no
// network, no third-party dependency.
//
// The pipeline is deliberately split into small named steps so the flow is
// readable:
//   1. resolveOutputDir   — MAKEFUN_OUTPUT_DIR or /output when unset.
//   2. validateScreenshots — refuse a bad screenshot set before we copy anything.
//   3. assemble            — copy game/ and screenshots/ into the output dir.
//   4. writeDossier        — build dossier.json from what we copied.
//   5. report             — one summary line on stdout.
//
// Local development (outside the grader): point MAKEFUN_OUTPUT_DIR at a
// scratch dir and run `node main.ts`. Serve the result with `node serve.ts`.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** This source file's own directory (the repository root). */
const HERE = fileURLToPath(new URL('.', import.meta.url));

/** The output directory: the grader's env var when present, else /output. */
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Subfolders beside this file that make up the entry. */
const GAME_DIR = 'game';
const SHOTS_DIR = 'screenshots';

/** The screenshot set the gate accepts: three or four images, each small. */
const MIN_SHOTS = 3;
const MAX_SHOTS = 4;
const MAX_SHOT_BYTES = 262144;

/** The dossier caps, matching the bounty's gate.json (reference/gate.json). */
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

/**
 * Normalize an output path: the env var when set, otherwise /output.
 * Whitespace-only or empty values are treated as unset.
 */
function resolveOutputDir(): string {
  const fromEnv = process.env.MAKEFUN_OUTPUT_DIR?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : '/output';
}

/** Recursively collect every regular file under `root`, as relative paths. */
function listFilesUnder(root: string): string[] {
  const found: string[] = [];
  const scan = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        scan(join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        found.push(childRel);
      }
    }
  };
  scan(root, '');
  return found.sort();
}

/**
 * Validate the screenshots/ folder *before* any copy: it must hold between
 * MIN_SHOTS and MAX_SHOTS image files and each must be at most
 * MAX_SHOT_BYTES bytes. On any failure this throws a specific error naming
 * exactly what is wrong (missing folder, wrong count, an oversized file), so
 * a broken entry fails loudly rather than shipping a half-built output.
 */
function validateScreenshots(): string[] {
  const shotsDir = join(HERE, SHOTS_DIR);
  if (!existsSync(shotsDir) || !statSync(shotsDir).isDirectory()) {
    throw new Error(
      `${SHOTS_DIR}/ is missing beside main.ts: an entry hands in ${MIN_SHOTS}–${MAX_SHOTS} renders of its game, the first by name the cover.`,
    );
  }

  const names = readdirSync(shotsDir)
    .filter((name) => !name.startsWith('.'))
    .sort();

  if (names.length < MIN_SHOTS) {
    throw new Error(
      `${SHOTS_DIR}/ holds ${names.length} file(s); the gate needs at least ${MIN_SHOTS} screenshots.`,
    );
  }
  if (names.length > MAX_SHOTS) {
    throw new Error(
      `${SHOTS_DIR}/ holds ${names.length} files; the gate allows at most ${MAX_SHOTS} screenshots.`,
    );
  }

  for (const name of names) {
    const size = statSync(join(shotsDir, name)).size;
    if (size > MAX_SHOT_BYTES) {
      throw new Error(
        `${SHOTS_DIR}/${name} is ${size} bytes, over the ${MAX_SHOT_BYTES}-byte limit.`,
      );
    }
  }

  return names;
}

/** Copy game/ and screenshots/ beside this file into the output directory. */
function copyAssets(): void {
  mkdirSync(OUT, { recursive: true });

  cpSync(join(HERE, GAME_DIR), join(OUT, GAME_DIR), { recursive: true });

  mkdirSync(join(OUT, SHOTS_DIR), { recursive: true });
  cpSync(join(HERE, SHOTS_DIR), join(OUT, SHOTS_DIR), { recursive: true });
}

/** Write dossier.json from the assembled output directory. */
function writeDossier(): void {
  const dossier = buildDossier(OUT, DOSSIER_CAPS);
  writeFileSync(join(OUT, 'dossier.json'), dossier);
}

/** Print the one summary line the grader and I both read. */
function report(gameFileCount: number, shotCount: number): void {
  console.log(
    `packaged ${gameFileCount} game file(s) and ${shotCount} screenshot(s) into ${OUT}`,
  );
}

function main(): void {
  const shots = validateScreenshots();
  copyAssets();
  writeDossier();
  const gameFiles = listFilesUnder(join(OUT, GAME_DIR));
  report(gameFiles.length, shots.length);
}

main();
