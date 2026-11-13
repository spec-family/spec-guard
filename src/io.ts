/**
 * The one door every read of a codebase goes through.
 *
 * A plain run reads through `nodeIo`. A watch session hands every reader a door
 * of its own that caches what was read and records who read it, because the
 * session can only evict what it saw being read, and it only sees reads here.
 * A module that reached for `node:fs` itself would be invisible to it, and a
 * rule that read through that module would go on reporting a file that has
 * since changed. ADR-0014 asserts that nothing else imports `node:fs`.
 */

import { promises as fs, watch, type Dirent, type Stats } from 'node:fs';
import path from 'node:path';

/** Reads one directory's entries, in whatever order the filesystem returns them. */
export type DirectoryReader = (directory: string) => Promise<Dirent[]>;

export interface Io {
  /** A directory's entries. Rejects when the directory cannot be listed. */
  readDirectory: DirectoryReader;
  /** `stat`, following links, or null for a path that cannot be stat'd. */
  stat(target: string): Promise<Stats | null>;
  /** A file's bytes. Rejects when the file cannot be read. */
  readFile(file: string): Promise<Buffer>;
  /** The path with every link resolved. Rejects when it cannot be resolved. */
  realpath(target: string): Promise<string>;
}

/**
 * The filesystem, as Node reads it.
 *
 * `stat` answers null rather than rejecting because every caller asks one
 * question of it - is anything there - and five `.catch(() => null)` tails were
 * five copies of that answer. The other three reject, because an unreadable
 * directory or file is something each caller reports in its own words.
 */
export const nodeIo: Io = {
  readDirectory: (directory) => fs.readdir(directory, { withFileTypes: true }),
  stat: (target) => fs.stat(target).catch(() => null),
  readFile: (file) => fs.readFile(file),
  realpath: (target) => fs.realpath(target),
};

/** A watch on a directory tree, until it is closed. */
export interface TreeWatcher {
  close(): void;
}

/** Reports that something under a watched root changed, or that it cannot tell what. */
export type TreeListener = (type: 'rename' | 'change', filename: string | null) => void;

/**
 * Watches everything under a directory, with one recursive watcher on it.
 *
 * One, not one per directory. A watcher holds its directory open, and on Windows
 * that makes renaming a directory above it fail with EPERM - which is what
 * `git checkout` and an editor's folder rename both do. ADR-0014 measured it.
 * Setting up the watch can throw, and a watch that fails later reports to
 * `onError`. Node's `watch` is a parameter so a test can make it fail.
 */
export function watchTree(root: string, listener: TreeListener, onError: (error: Error) => void, start: typeof watch = watch): TreeWatcher {
  const watcher = start(root, { recursive: true }, (type, filename) => listener(type, filename ?? null));
  watcher.on('error', onError);
  return { close: () => watcher.close() };
}

/**
 * How a root-relative path is spelled on disk, segment by segment.
 *
 * A segment keeps its own spelling where its directory holds an entry of
 * that name. Where it holds none, and `opens` says the path as written up to
 * that segment opens anyway - which a filesystem that ignores case does, as
 * Windows' and macOS's do - the segment is spelled as the one entry that
 * differs from it only in case. A segment that opens nothing ends the
 * reading, and the rest is kept as written: `SRC/new.ts` is `src/new.ts` on
 * Windows, and stays `SRC/new.ts` on Linux, where `SRC` is a directory still
 * to make. A directory that cannot be listed keeps the segment as written,
 * and the reading goes on below it. The root, `.` or empty, names nothing a
 * directory holds and is kept as it is. spec-harness spells a path the same
 * way, through the filesystem's own real path.
 */
export async function spelledOnDisk(
  relative: string,
  names: (directory: string) => Promise<readonly string[] | null>,
  opens: (written: string) => Promise<boolean>,
): Promise<string> {
  const segments = relative.split('/');
  const spelled: string[] = [];
  for (const [at, segment] of segments.entries()) {
    const entries = await names(spelled.length === 0 ? '.' : spelled.join('/'));
    if (entries === null || entries.includes(segment)) {
      spelled.push(segment);
      continue;
    }
    const folded = segment.toLowerCase();
    const variants = entries.filter((entry) => entry.toLowerCase() === folded);
    if (variants.length !== 1 || !(await opens([...spelled, segment].join('/')))) return [...spelled, ...segments.slice(at)].join('/');
    spelled.push(variants[0]!);
  }
  return spelled.join('/');
}

/** `spelledOnDisk` through a door, from a root. */
export function spelling(io: Io, root: string, relative: string): Promise<string> {
  return spelledOnDisk(
    relative,
    async (directory) => {
      const entries = await io.readDirectory(path.join(root, directory)).catch(() => null);
      return entries === null ? null : entries.map((entry) => entry.name);
    },
    async (written) => (await io.stat(path.join(root, written))) !== null,
  );
}

/** Reads a file as UTF-8 text through a door. */
export async function readText(io: Io, file: string): Promise<string> {
  return (await io.readFile(file)).toString('utf8');
}
