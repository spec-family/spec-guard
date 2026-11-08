/**
 * One reading of a regex rule, for both engines. ADR-0007, amended
 * 2026-10-24.
 *
 * ripgrep only names the files the scanner reads, so a file its reading of a
 * pattern leaves out is a file whose matches are never counted, and a rule
 * they would fail passes. ripgrep reads a pattern as the regex crate's
 * documentation says, and JavaScript gave some of the same text another
 * meaning: its `\w`, `\b` and `\d` were ASCII and its `\s` held U+FEFF and not
 * NEL, where the crate's are Unicode's; a character was a UTF-16 unit; and
 * `\A`, `\<` or `[[:alpha:]]` were letters and brackets. So the scanner is
 * given each rule as the crate reads it, in JavaScript's `v` mode, which reads
 * a character as a code point, folds case by Unicode's simple case folding as
 * the crate does, and holds a class inside a class:
 *
 * - `\w`, `\d`, `\s`, their negations, `\b` and `\B` are the crate's Unicode
 *   ones, and so is the boundary `word="true"` puts round a rule;
 * - `^` and `$` meet each line, as ripgrep reads one with `--crlf`;
 * - what the crate reads and JavaScript read otherwise is refused, naming it,
 *   since one engine would count what the other never named;
 * - what JavaScript read without `v` as itself is kept as itself: an escaped
 *   sign, a lone `]`, a `{` or `}` that is no count, and a `-` beside a class
 *   escape in a class. The crate reads each the same, but a `{` and that `-`,
 *   which it refuses, and which the scanner then answers alone;
 * - what only JavaScript reads, a look-around or a back-reference, is the
 *   scanner's alone, as before: ripgrep refuses the pattern, and the scanner
 *   answers the search;
 * - a byte that is no UTF-8 is no character to `.`, to a class or to a
 *   negated one, as ripgrep reads its bytes: the scanner reads such a byte as
 *   a lone surrogate (`readBytes`), and every class it is given leaves those
 *   out. ADR-0007, amended 2026-11-08.
 */

import { isUtf8 } from 'node:buffer';

/**
 * The regex crate's `\w`: `\p{Alphabetic}`, `\p{M}`, `\d`, `\p{Pc}` and
 * `\p{Join_Control}`, as its documentation lists them (regex 1.13.1, read
 * 2026-10-24). JavaScript's is `[A-Za-z0-9_]`, and a literal's word boundary
 * here was `\p{L}`, `\p{N}` and `_`, which holds no mark and no ZWJ.
 */
export const WORD_CHARACTER = String.raw`[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}]`;

const NOT_WORD_CHARACTER = `[^${WORD_CHARACTER.slice(1)}`;

/** The crate's `\d`, `\s`, `\w` and their negations, each of which stands in a class as well as outside one. */
const CLASS_ESCAPES: Readonly<Record<string, string>> = {
  d: String.raw`\p{Nd}`,
  D: String.raw`\P{Nd}`,
  s: String.raw`\p{White_Space}`,
  S: String.raw`\P{White_Space}`,
  w: WORD_CHARACTER,
  W: NOT_WORD_CHARACTER,
};

/**
 * What stands for a byte that is no UTF-8 in the text the scanner reads: a
 * lone surrogate, which no text decoded from UTF-8 holds, so that a class can
 * leave every such byte out and keep every character in.
 */
const NOT_UTF8 = String.raw`\p{Cs}`;

/**
 * A word character on one side and none on the other, the start and the end
 * of the text standing for none, as the crate's `\b` reads; a byte that is
 * no UTF-8 is none.
 */
const BOUNDARY = `(?:(?<=${WORD_CHARACTER})(?!${WORD_CHARACTER})|(?<!${WORD_CHARACTER})(?=${WORD_CHARACTER}))`;

/**
 * The crate's `\B`, which it meets nowhere beside a byte that is no UTF-8: it
 * asks for a character it can read on either side, so as never to meet one
 * inside a character (regex-automata's `is_word_unicode_negate`). Measured
 * with ripgrep 15.0.0: `\Bfoo` over a Latin-1 `éfoo` names no file.
 */
const NOT_BOUNDARY = `(?:(?<!${NOT_UTF8})(?!${NOT_UTF8})(?:(?<=${WORD_CHARACTER})(?=${WORD_CHARACTER})|(?<!${WORD_CHARACTER})(?!${WORD_CHARACTER})))`;

/**
 * The half boundaries ripgrep's `--word-regexp` puts round a pattern,
 * `\b{start-half}` and `\b{end-half}`: no word character just before the
 * match, and none just after it. Like `\B`, the crate meets neither beside a
 * byte that is no UTF-8: `-w foo` over a Latin-1 `fooé` names no file.
 */
export const WORD_START = `(?<!${WORD_CHARACTER})(?<!${NOT_UTF8})`;
export const WORD_END = `(?!${WORD_CHARACTER})(?!${NOT_UTF8})`;

/**
 * U+2028 and U+2029, at which JavaScript's `m` ends a line and ripgrep
 * does not. Made from their numbers, so that no separator stands in this file
 * where an editor would show a line break.
 */
const SEPARATORS = String.fromCharCode(0x2028, 0x2029);

/**
 * `^` and `$` as ripgrep reads them with `--crlf`: at the start and at the
 * end of each line, a line ending at LF, at CRLF or at a lone CR, with no line
 * after the last line end. JavaScript's `m` reads three lines more, and each
 * is taken back out: one between the CR and the LF of a CRLF, one after the
 * last line end (and so in an empty file), and a line end at each separator.
 * With `m` alone `\s+$` matched on every line of a CRLF file and on the
 * last of every file, `^` met each CRLF line twice, and a line begun at a
 * separator was counted in a file ripgrep never named. ADR-0007, amended
 * 2026-10-19.
 */
const LINE_START = `(?:^(?<![${SEPARATORS}])(?!(?<=\\r)\\n)(?=[\\s\\S]))`;
const LINE_END = `(?:$(?![${SEPARATORS}])(?!(?<=\\r)\\n)(?!(?<![^\\n\\r])(?![\\s\\S])))`;

/**
 * JavaScript's `.`, which matches no line end and no separator (ADR-0007,
 * amended 2026-10-19), and no byte that is no UTF-8, as the crate's matches
 * none. Written out, since `v` mode's `.` matches a lone surrogate.
 */
const ANY_CHARACTER = String.raw`[^\n\r${SEPARATORS}${NOT_UTF8}]`;

/** A class with no byte that is no UTF-8 in it, as ripgrep reads every class. */
function characters(set: string): string {
  return `[${set}--${NOT_UTF8}]`;
}

/** What the crate reads in an escape that JavaScript read as the letter or the sign itself. */
const RIPGREP_ESCAPES: Readonly<Record<string, string>> = {
  A: 'the start of the text',
  z: 'the end of the text',
  '<': 'the start of a word',
  '>': 'the end of a word',
  a: 'a bell, U+0007',
  U: 'a code point in eight hex digits',
};

/** A count JavaScript reads after an atom: `{n}`, `{n,}` or `{n,m}`. */
const COUNT = /\{\d+(?:,\d*)?\}/y;

/**
 * A count with blanks in it, `{2, 3}`, which ripgrep 15.0.0 reads as a count
 * (measured; its documentation does not say) and JavaScript as characters.
 */
const BLANK_COUNT = /\{\s*\d+\s*(?:,\s*\d*\s*)?\}/y;

/**
 * An escape that holds a name or a number between brackets: `\p{...}`,
 * `\P{...}`, `\u{...}` and `\k<...>`. Read as a match of its own, so that no
 * reading of a rule steps back. One left open is read a character at a time,
 * and `v` mode refuses it in the words it has for it read whole.
 */
const NAMED = /\\[pPu]\{[^}]*\}|\\k<[^>]*>/y;

/** A group's name, which may hold a `$`; one left open is read as `NAMED` reads one. */
const GROUP_NAME = /\(\?<(?![=!])[^>]*>/y;

/** A UTF-16 escape, `\u0041`, which may be half a character, `\uD83D`. */
const UNIT = /\\u[0-9A-Fa-f]{4}/y;

/**
 * Flags, `(?i)`, or a group with flags, `(?i:` or `(?-s:`. ripgrep reads
 * both; JavaScript reads no `(?i)`, and a group with flags only from Node 23,
 * where spec-guard runs on Node 22 too.
 */
const FLAGS = /\(\?(?=[A-Za-z-])[A-Za-z]*(?:-[A-Za-z]*)?[:)]/y;

function isSurrogate(point: number): boolean {
  return point >= 0xd800 && point <= 0xdfff;
}

function refuse(source: string, reason: string): never {
  throw new SyntaxError(`Invalid regular expression: /${source}/: ${reason}`);
}

/**
 * ASCII that is neither a letter nor a digit, which the crate reads as itself
 * after a backslash, `<` and `>` aside, and which `v` mode reads as itself
 * written as a hex escape, in a class and outside one.
 */
function isAsciiSign(char: string): boolean {
  return char.charCodeAt(0) < 0x80 && !/[0-9A-Za-z]/.test(char);
}

function hex(char: string): string {
  return `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`;
}

interface Piece {
  /** The piece as `v` mode reads it. */
  text: string;
  /** How many characters of the rule it stands for. */
  length: number;
  /** Whether it stands for a class of characters, which no range can end at; a piece that does not, says nothing. */
  set?: boolean;
}

/** The escape that starts at `at`, which is a backslash. */
function escapeAt(source: string, at: number, inClass: boolean): Piece {
  const next = source.charAt(at + 1);
  const known = CLASS_ESCAPES[next];
  // In a class too, where the class leaves what is no UTF-8 out again: one
  // reading wherever the escape stands.
  if (known !== undefined) return { text: characters(known), length: 2, set: true };
  const ripgrep = RIPGREP_ESCAPES[next];
  // In a class the crate refuses a `\<`, a `\A` and a `\z`, and the scanner
  // answers as JavaScript reads it, which `v` mode accepts or refuses itself.
  if (ripgrep !== undefined && (!inClass || next === 'a' || next === 'U')) {
    refuse(source, `"\\${next}" is ${ripgrep} to ripgrep and "${next}" to JavaScript`);
  }
  const after = source.charAt(at + 2);
  if (next === 'b' || next === 'B') {
    if (inClass) return { text: next === 'b' ? '\\x08' : '\\B', length: 2 };
    if (next === 'b' && after === '{') refuse(source, '"\\b{" is a word boundary of the kind its braces name to ripgrep, and a word boundary before a "{" to JavaScript');
    return { text: next === 'b' ? BOUNDARY : NOT_BOUNDARY, length: 2 };
  }
  if ((next === 'p' || next === 'P') && after !== '{') {
    refuse(source, `"\\${next}${after}" is a class of characters to ripgrep and "${next}${after}" to JavaScript`);
  }
  if (next === 'x' && after === '{') refuse(source, '"\\x{" is the code point its braces hold to ripgrep, and an "x" and braces to JavaScript');
  UNIT.lastIndex = at;
  const unit = UNIT.exec(source)?.[0];
  // Two halves in a row are a character to `v` mode, and refused all the
  // same: ripgrep refuses both, and the character has an escape of its own.
  // Any other unit is read below as JavaScript reads it, its digits after it.
  if (unit !== undefined && isSurrogate(parseInt(unit.slice(2), 16))) {
    refuse(source, `"${unit}" is half a character to JavaScript, and ripgrep refuses it: no UTF-8 text holds one, so write the whole character, as \\u{1F600}`);
  }
  // No sign between the brackets is the class's or the rule's own. `v` mode
  // refuses a `\k<...>` in a class, read whole or not.
  NAMED.lastIndex = at;
  const named = NAMED.exec(source);
  if (named !== null) {
    const text = named[0];
    if (next === 'u') {
      if (isSurrogate(parseInt(text.slice(3, -1), 16))) refuse(source, `"${text}" is half a character to JavaScript, and ripgrep refuses it: no UTF-8 text holds one, so write the whole character, as \\u{1F600}`);
      return { text, length: text.length };
    }
    return { text: next === 'k' ? text : characters(text), length: text.length, set: true };
  }
  if (isAsciiSign(next)) return { text: hex(next), length: 2 };
  // A letter, a digit, any other character, or nothing: `v` mode reads it as
  // JavaScript reads it, or refuses it, as it refuses a trailing backslash.
  // Two on from a trailing backslash is past the end, where every reading
  // here stops.
  return { text: source.slice(at, at + 2), length: 2 };
}

/** The class that starts at `at`, which is a `[`, and whether it is `[]` or `[^]`, which the crate does not close where JavaScript does. */
function classAt(source: string, at: number): { text: string; length: number; empty: boolean } {
  let i = at + 1;
  const negated = source.charAt(i) === '^';
  if (negated) i += 1;
  // `[^]` is any character to JavaScript, which ripgrep reads only where it refuses the rule.
  if (source.charAt(i) === ']') return { text: negated ? `[^${NOT_UTF8}]` : '[]', length: i + 1 - at, empty: true };
  const atoms: Array<{ text: string; set?: boolean; dash: boolean }> = [];
  while (i < source.length && source.charAt(i) !== ']') {
    const pair = source.slice(i, i + 2);
    if (pair === '&&' || pair === '--' || pair === '~~') {
      refuse(source, `"${pair}" in a class is an operation on two classes to ripgrep and two characters to JavaScript`);
    }
    const char = source.charAt(i);
    if (char === '[') refuse(source, '"[" in a class is a class inside it to ripgrep, as in [[:alpha:]], and a "[" to JavaScript');
    if (char === '\\') {
      const escape = escapeAt(source, i, true);
      atoms.push({ text: escape.text, set: escape.set, dash: false });
      i += escape.length;
      continue;
    }
    const point = String.fromCodePoint(source.codePointAt(i)!);
    atoms.push({ text: isAsciiSign(point) ? hex(point) : point, dash: point === '-' });
    i += point.length;
  }
  // A `-` between two characters is a range to both. Beside a class escape,
  // or after a range, JavaScript read it as itself. Two in a row are refused
  // above, so neither end of a range is a `-` that could start another.
  let body = '';
  for (let k = 0; k < atoms.length; k += 1) {
    const atom = atoms[k]!;
    const end = atoms[k + 2];
    const ranged = !atom.set && atoms[k + 1]?.dash === true && end !== undefined && !end.set;
    body += ranged ? `${atom.text}-${end.text}` : atom.text;
    k += ranged ? 2 : 0;
  }
  // The class's `]`, or nothing where the rule ends first: an unterminated
  // class stays unterminated, for `v` mode to refuse.
  const closed = source.charAt(i);
  const set = `[${negated ? '^' : ''}${body}${closed}`;
  return { text: closed === '' ? set : characters(set), length: i + closed.length - at, empty: false };
}

/**
 * A regex rule's source as the scanner reads it, in JavaScript's `v` mode:
 * the reading ripgrep has of it, where the two dialects meet.
 *
 * Throws a SyntaxError, worded as JavaScript words its own, for a rule the
 * two engines would read differently.
 */
export function readRegex(source: string): string {
  let read = '';
  let at = 0;
  let empty = '';
  // `<=` for the `<` reads one place past the end, where `charAt` gives
  // nothing and nothing is added: an equivalent mutant.
  while (at < source.length) {
    const char = source.charAt(at);
    if (char === '\\') {
      const escape = escapeAt(source, at, false);
      read += escape.text;
      at += escape.length;
      continue;
    }
    if (char === '[') {
      const found = classAt(source, at);
      read += found.text;
      if (found.empty) empty = source.slice(at, at + found.length);
      at += found.length;
      continue;
    }
    FLAGS.lastIndex = at;
    const flags = FLAGS.exec(source)?.[0];
    if (flags !== undefined) {
      const without = 'write ignore-case="true" for the whole rule, or the cases as a class, as [Aa]';
      refuse(
        source,
        flags.endsWith(':')
          ? `"${flags}" is a group with flags to ripgrep, and to JavaScript only from Node 23, where spec-guard runs on Node 22 too: ${without}`
          : `"${flags}" sets flags for the rest of the rule to ripgrep, and is no group to JavaScript: ${without}`,
      );
    }
    GROUP_NAME.lastIndex = at;
    const group = GROUP_NAME.exec(source);
    if (group !== null) {
      read += group[0];
      at += group[0].length;
      continue;
    }
    if (char === '{') {
      COUNT.lastIndex = at;
      const count = COUNT.exec(source);
      BLANK_COUNT.lastIndex = at;
      const blank = count === null ? BLANK_COUNT.exec(source) : null;
      if (blank !== null) refuse(source, `"${blank[0]}" is a count to ripgrep, which reads one with blanks in it, and those characters to JavaScript`);
      read += count === null ? '\\{' : count[0];
      at += count === null ? 1 : count[0].length;
      continue;
    }
    if (char === ']' && empty !== '') {
      refuse(source, `"${empty}" before a "]" is a class holding the "]" to ripgrep, and ${empty === '[]' ? 'no character' : 'any character'} to JavaScript`);
    }
    read += char === '^' ? LINE_START : char === '$' ? LINE_END : char === '.' ? ANY_CHARACTER : char === ']' || char === '}' ? `\\${char}` : char;
    at += 1;
  }
  return read;
}

/**
 * The regular expression the scanner matches a regex rule with: the rule as
 * `readRegex` reads it, between word boundaries for `word="true"`, which
 * ripgrep's `--word-regexp` puts round a pattern as `\b{start-half}` and
 * `\b{end-half}`: no word character before the match and none after it.
 */
export function buildRegexRule(symbol: string, flags: string, word: boolean): RegExp {
  const read = readRegex(symbol);
  const source = word ? `${WORD_START}(?:${read})${WORD_END}` : read;
  try {
    return new RegExp(source, `${flags}mv`);
  } catch (error) {
    // V8 names the source it was given, which is the reading, not the rule.
    const message = (error as Error).message;
    refuse(symbol, message.slice(message.lastIndexOf(': ') + 2));
  }
}

/**
 * How many bytes the well-formed UTF-8 sequence at `at` takes, or 0 where
 * none starts there, by Unicode's table of well-formed byte sequences
 * (chapter 3, table 3-7): what ripgrep's `.` reads as a character. Its byte
 * there is not ASCII.
 */
function sequenceAt(bytes: Uint8Array, at: number): number {
  const lead = bytes[at]!;
  // A byte of 80 to BF only continues a sequence, and C0, C1 and F5 to FF
  // start none.
  const size = lead < 0xc2 ? 0 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : lead < 0xf5 ? 4 : 0;
  // After four leads the second byte is narrower: a shorter form of a
  // character, a surrogate and what is past U+10FFFF are no UTF-8.
  const low = lead === 0xe0 ? 0xa0 : lead === 0xf0 ? 0x90 : 0x80;
  const high = lead === 0xed ? 0x9f : lead === 0xf4 ? 0x8f : 0xbf;
  for (let k = 1; k < size; k += 1) {
    // Past the end is a sequence cut short, which is no character.
    const byte = bytes[at + k] ?? 0;
    if (byte < (k === 1 ? low : 0x80) || byte > (k === 1 ? high : 0xbf)) return 0;
  }
  return size;
}

/**
 * A file's bytes as the scanner reads them, and whether all of them were
 * UTF-8. ripgrep reads bytes, and its `.` and classes match no byte that is
 * no UTF-8, where Node's decoder reads one as U+FFFD, which they match: so
 * `x.y` over a Latin-1 `xéy` was counted by the scanner in a file ripgrep
 * never named. Each such byte is read here as U+D800 plus the byte, the first
 * half of a character with no second half after it, which every class
 * `readRegex` writes leaves out and which a line end reads as ripgrep does:
 * a character. Being a first half, it is no place `scanContent` takes for
 * the middle of a character. ADR-0007, amended 2026-11-08.
 */
export function readBytes(bytes: Buffer): { text: string; utf8: boolean } {
  if (isUtf8(bytes)) return { text: bytes.toString('utf8'), utf8: true };
  // Two bytes of UTF-16 for each byte read at most: a character of four
  // bytes is two units, and one of two or three bytes is one.
  const units = Buffer.alloc(bytes.length * 2);
  let length = 0;
  const put = (unit: number): void => {
    units.writeUInt16LE(unit, length);
    length += 2;
  };
  for (let at = 0; at < bytes.length; ) {
    const lead = bytes[at]!;
    const size = lead < 0x80 ? 1 : sequenceAt(bytes, at);
    if (size === 0) {
      put(0xd800 | lead);
      at += 1;
      continue;
    }
    let point = size === 1 ? lead : lead & (0xff >> (size + 1));
    for (let k = 1; k < size; k += 1) point = (point << 6) | (bytes[at + k]! & 0x3f);
    if (point > 0xffff) {
      put(0xd7c0 + (point >> 10));
      put(0xdc00 | (point & 0x3ff));
    } else {
      put(point);
    }
    at += size;
  }
  return { text: units.toString('utf16le', 0, length), utf8: false };
}

/** Every byte that is no UTF-8 in a text the scanner read; built at run time, as a literal with `v` needs ES2024. */
const NOT_UTF8_BYTES = new RegExp(NOT_UTF8, 'gv');

/** A line of text the scanner read, as a report shows it: a byte that is no UTF-8 as U+FFFD. */
export function shownLine(line: string): string {
  return line.replace(NOT_UTF8_BYTES, '\uFFFD');
}
