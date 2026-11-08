/**
 * One dialect for a regex rule, read by both engines alike. ADR-0007, amended
 * 2026-10-24.
 *
 * ripgrep only names the files the scanner reads, and it read a rule's `\w`,
 * `\b`, `\d` and `\s` as Unicode's where JavaScript read them as ASCII (and
 * its `\s` with U+FEFF and without NEL), a character as a code point where
 * JavaScript read a UTF-16 unit, and `\A` or `[[:alpha:]]` as what the regex
 * crate documents where JavaScript read letters and brackets. Each was a file
 * the scanner counted in and ripgrep left out: a pass under `--engine rg`.
 * The scanner now reads a rule as the crate does, and refuses what the two
 * would read apart. The cases that must still be read as before are here
 * too.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { createCommentMask } from '../src/comments.js';
import { readBytes } from '../src/dialect.js';
import { buildJsRegExp, javascriptEngine, resolveEngine, scanContent, type SearchRequest } from '../src/engine.js';
import { formatJson, formatReport } from '../src/reporter.js';
import { runSpecGuard } from '../src/runner.js';
import type { SearchOptions } from '../src/types.js';
import { findTestRipgrep, makeTempRepo, removeTempRepo, searchOptions } from './helpers.js';

const at = (...points: number[]): string => String.fromCodePoint(...points);

const E_ACUTE = at(0xe9); // a letter
const MARK = at(0x301); // a combining mark
const ZWJ = at(0x200d); // Join_Control
const UNDERTIE = at(0x203f); // connector punctuation
const CIRCLED_A = at(0x24b6); // a symbol that is Alphabetic
const ARABIC_THREE = at(0x663); // a decimal digit
const SUPERSCRIPT_TWO = at(0xb2); // a number, and no decimal digit
const ROMAN_EIGHT = at(0x2167); // a number that is Alphabetic
const BOM = at(0xfeff); // no White_Space
const NEL = at(0x85); // White_Space
const NBSP = at(0xa0); // White_Space
const KELVIN = at(0x212a);
const LONG_S = at(0x17f);
const SMILE = at(0x1f600); // two UTF-16 units

/** How many matches a rule over one text counts. */
function count(symbol: string, content: string, options: Partial<SearchOptions> = {}): number {
  return scanContent(content, 'a.txt', buildJsRegExp(symbol, searchOptions({ regex: true, ...options }))).count;
}

/** The reason a rule is refused for, or undefined when it is read. */
function refusal(symbol: string): string | undefined {
  try {
    buildJsRegExp(symbol, searchOptions({ regex: true }));
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

describe('a class, as the regex crate reads it', () => {
  it('reads \\w as Alphabetic, marks, decimal digits, connector punctuation and Join_Control', () => {
    for (const char of ['a', '_', '7', E_ACUTE, MARK, ZWJ, UNDERTIE, CIRCLED_A, ARABIC_THREE, ROMAN_EIGHT]) {
      expect(count(String.raw`x\wy`, `x${char}y`), char).toBe(1);
      expect(count(String.raw`x\Wy`, `x${char}y`), char).toBe(0);
      expect(count(String.raw`x[\w]y`, `x${char}y`), char).toBe(1);
      expect(count(String.raw`x[^\w]y`, `x${char}y`), char).toBe(0);
      expect(count(String.raw`x[\W]y`, `x${char}y`), char).toBe(0);
      expect(count(String.raw`x[^\W]y`, `x${char}y`), char).toBe(1);
    }
    for (const char of ['-', ' ', SUPERSCRIPT_TWO, BOM]) {
      expect(count(String.raw`x\wy`, `x${char}y`), char).toBe(0);
      expect(count(String.raw`x\Wy`, `x${char}y`), char).toBe(1);
      expect(count(String.raw`x[\W]y`, `x${char}y`), char).toBe(1);
    }
  });

  it('reads \\d as a decimal digit of any script, and no other number', () => {
    expect(count(String.raw`x\dy`, `x${ARABIC_THREE}y`)).toBe(1);
    expect(count(String.raw`x\Dy`, `x${ARABIC_THREE}y`)).toBe(0);
    expect(count(String.raw`x[\d]y`, `x${ARABIC_THREE}y`)).toBe(1);
    expect(count(String.raw`x[^\d]y`, `x${ARABIC_THREE}y`)).toBe(0);
    expect(count(String.raw`x[\D]y`, `x${ARABIC_THREE}y`)).toBe(0);
    expect(count(String.raw`x\dy`, `x${SUPERSCRIPT_TWO}y`)).toBe(0);
    expect(count(String.raw`x\Dy`, `x${SUPERSCRIPT_TWO}y`)).toBe(1);
    expect(count(String.raw`x\dy`, 'x7y')).toBe(1);
  });

  it('reads \\s as White_Space, which holds NEL and not U+FEFF', () => {
    expect(count(String.raw`a\sb`, `a${NEL}b`)).toBe(1);
    expect(count(String.raw`a\Sb`, `a${NEL}b`)).toBe(0);
    expect(count(String.raw`a\sb`, `a${BOM}b`)).toBe(0);
    expect(count(String.raw`a\Sb`, `a${BOM}b`)).toBe(1);
    expect(count(String.raw`a[\s]b`, `a${BOM}b`)).toBe(0);
    expect(count(String.raw`a[^\s]b`, `a${BOM}b`)).toBe(1);
    expect(count(String.raw`a[\S]b`, `a${NEL}b`)).toBe(0);
    expect(count(String.raw`a\sb`, `a${NBSP}b`)).toBe(1);
    expect(count(String.raw`a\sb`, 'a\tb')).toBe(1);
  });

  it('reads a class escape beside other members of a class', () => {
    expect(count(String.raw`x[a\W]y`, `x${E_ACUTE}y`)).toBe(0);
    expect(count(String.raw`x[a\W]y`, 'x-y')).toBe(1);
    expect(count(String.raw`x[a\W]y`, 'xay')).toBe(1);
    expect(count(String.raw`x[^a\W]y`, `x${E_ACUTE}y`)).toBe(1);
    expect(count(String.raw`x[^a\W]y`, 'xay')).toBe(0);
    expect(count(String.raw`x[\W_]+y`, 'x_-_y')).toBe(1);
    expect(count(String.raw`x[\s\S]y`, `x${SMILE}y`)).toBe(1);
  });
});

describe('a word boundary, as the regex crate reads it', () => {
  it('meets no boundary between two letters, either of them outside ASCII', () => {
    expect(count(String.raw`foo\b`, `foo${E_ACUTE}`)).toBe(0);
    expect(count(String.raw`\bfoo`, `${E_ACUTE}foo`)).toBe(0);
    expect(count(String.raw`\Wbar`, `${E_ACUTE}bar`)).toBe(0);
    expect(count(String.raw`foo\B`, `foo${E_ACUTE}`)).toBe(1);
    expect(count(String.raw`o\B${E_ACUTE}`, `fo${E_ACUTE}`)).toBe(1);
  });

  it('meets one between a letter and what is no word character, the ends of the text included', () => {
    expect(count(String.raw`foo\b`, 'foo-')).toBe(1);
    expect(count(String.raw`foo\b`, 'foo')).toBe(1);
    expect(count(String.raw`\bfoo`, 'foo')).toBe(1);
    expect(count(String.raw`${E_ACUTE}\b `, `x${E_ACUTE} y`)).toBe(1);
    expect(count(String.raw`${E_ACUTE}\B `, `x${E_ACUTE} y`)).toBe(0);
    expect(count(String.raw`\bfoo\b`, 'a foo b')).toBe(1);
    expect(count(String.raw`\Bfoo`, 'foo')).toBe(0);
  });

  it('puts the same boundary round a literal and a regex with word', () => {
    for (const regex of [false, true]) {
      for (const char of [E_ACUTE, MARK, ZWJ, UNDERTIE, CIRCLED_A, ARABIC_THREE, ROMAN_EIGHT, '_', 'b']) {
        expect(count('foo', `x foo${char} y`, { regex, word: true }), `${regex} ${char}`).toBe(0);
        expect(count('foo', `x ${char}foo y`, { regex, word: true }), `${regex} ${char}`).toBe(0);
      }
      for (const char of [SUPERSCRIPT_TWO, '-', ' ', BOM]) {
        expect(count('foo', `x foo${char} y`, { regex, word: true }), `${regex} ${char}`).toBe(1);
      }
      expect(count('foo', 'foo', { regex, word: true })).toBe(1);
    }
  });

  it('puts it round the whole of a regex, as ripgrep puts the half boundaries round a pattern', () => {
    expect(count('-foo', 'a-foo b', { word: true })).toBe(0);
    expect(count('-foo', ' -foo b', { word: true })).toBe(1);
    expect(count('a|bc', 'xbc a', { word: true })).toBe(1);
  });
});

describe('a character, and its case, as the regex crate reads them', () => {
  it('reads a character outside the Basic Multilingual Plane as one', () => {
    expect(count('^.$', SMILE)).toBe(1);
    expect(count('^..$', SMILE)).toBe(0);
    expect(count('x[^a]y', `x${SMILE}y`)).toBe(1);
    expect(count('x[^a][^a]y', `x${SMILE}y`)).toBe(0);
  });

  it('steps past an empty match by a character, one outside the Basic Multilingual Plane included', () => {
    // One unit on, V8 moves the index back to the character's first unit
    // and meets the same empty match again: the scan never came back.
    expect(count('x*', `a${SMILE}b`)).toBe(4);
    expect(count(String.raw`\B`, `${SMILE}${SMILE}`)).toBe(3);
    // U+FFFF is the last character of one unit, and is stepped past by one.
    expect(count('x*', `a${at(0xffff)}b`)).toBe(4);
    // Nor between its two units, where a look-behind once met an empty
    // match: a word character before the smile and after it, and no place
    // that is not a boundary.
    expect(count(String.raw`\B`, `x${SMILE}y`)).toBe(0);
    expect(count(String.raw`(?<!\p{L})`, `x${SMILE}y`)).toBe(2);
    expect(count('x*', `a${SMILE}b`, { word: true })).toBe(0);
    // In a comment as well: the six places of `// a`, the smile and `b`.
    const content = `// a${SMILE}b\nx\n`;
    const tally = scanContent(content, 'a.ts', buildJsRegExp('x*', searchOptions({ regex: true })), () => createCommentMask(content, 'a.ts'));
    expect(tally).toMatchObject({ count: 3, commentCount: 6 });
    // And a match in a comment that is not empty is stepped past by nothing.
    const twice = '// xx\n';
    expect(scanContent(twice, 'a.ts', buildJsRegExp('x', searchOptions({ regex: true })), () => createCommentMask(twice, 'a.ts'))).toMatchObject({ count: 0, commentCount: 2 });
  });

  it('counts no empty match after the last line end, where no line is, as ripgrep names no file for one', () => {
    expect(count('x*', 'a\n')).toBe(2);
    expect(count('x*', 'a')).toBe(2);
    expect(count('x*', '')).toBe(0);
    expect(count('x?', '\n')).toBe(1);
    expect(count(String.raw`\B`, 'a\n')).toBe(0);
    expect(count(String.raw`\B`, 'a\r')).toBe(1);
    expect(count('a\n', 'a\n')).toBe(1);
  });

  it('folds case by Unicode simple case folding', () => {
    expect(count('xky', `x${KELVIN}y`, { ignoreCase: true })).toBe(1);
    expect(count('xsy', `x${LONG_S}y`, { ignoreCase: true })).toBe(1);
    expect(count(`x${at(0xdf)}y`, `x${at(0x1e9e)}y`, { ignoreCase: true })).toBe(1);
    expect(count('x[^a-z]y', `x${KELVIN}y`, { ignoreCase: true })).toBe(0);
    expect(count(String.raw`x\Wy`, `x${LONG_S}y`, { ignoreCase: true })).toBe(0);
    expect(count('xky', `x${KELVIN}y`)).toBe(0);
    expect(count(`x${at(0x130)}y`, 'xiy', { ignoreCase: true })).toBe(0);
  });

  it('reads a property and a code point in braces', () => {
    expect(count(String.raw`x\p{L}y`, `x${E_ACUTE}y`)).toBe(1);
    expect(count(String.raw`x\p{L}y`, 'xp{L}y')).toBe(0);
    expect(count(String.raw`x\P{L}y`, 'x-y')).toBe(1);
    expect(count(String.raw`x\p{Script=Greek}y`, `x${at(0x3b1)}y`)).toBe(1);
    expect(count(String.raw`\u{41}`, 'A')).toBe(1);
    expect(count(String.raw`x[\u{41}]y`, 'xAy')).toBe(1);
    // What follows a property is read as the rest of the rule is.
    expect(count(String.raw`\p{L}\w`, `${E_ACUTE}${E_ACUTE}`)).toBe(1);
    expect(count(String.raw`x[\p{L}-.]y`, 'x-y')).toBe(1);
    expect(count(String.raw`x[\u{41}-\u{43}]y`, 'xBy')).toBe(1);
  });
});

describe('what JavaScript read as itself', () => {
  it('keeps an escaped sign as the sign, outside a class and in one', () => {
    for (const sign of ['-', '#', ' ', ':', '@', '%', '=', '"', "'", '_', ',', ';', '!', '&', '~', '`', '/', '.', '$', '^']) {
      expect(count(`x\\${sign}y`, `x${sign}y`), sign).toBe(1);
      expect(count(`x[\\${sign}]y`, `x${sign}y`), sign).toBe(1);
      expect(count(`x\\${sign}y`, 'xay'), sign).toBe(0);
    }
    // A sign below U+0010, written with two hex digits.
    expect(count('x\\\ty', 'x\ty')).toBe(1);
    // A `<` after an escaped sign opens no group's name, as after `\k` it does.
    expect(count('x\\-<y>', 'x-<y>')).toBe(1);
    // And a sign written plain in a class, which `v` mode reads only escaped.
    for (const sign of ['(', ')', '|', '{', '}', '/', '$', '^', '&', '~', '.', '*']) {
      expect(count(`x[a${sign}]y`, `x${sign}y`), sign).toBe(1);
    }
  });

  it('keeps a lone ], a lone } and a { that is no count', () => {
    expect(count('x]y', 'x]y')).toBe(1);
    expect(count('x}y', 'x}y')).toBe(1);
    expect(count(String.raw`if \(x\) {`, 'if (x) {')).toBe(1);
    expect(count('xa{,3}y', 'xa{,3}y')).toBe(1);
    expect(count('xa{y', 'xa{y')).toBe(1);
    expect(count(String.raw`\[TODO]`, '[TODO]')).toBe(1);
    expect(count('xa{2}y', 'xaay')).toBe(1);
    expect(count('xa{2,}y', 'xaaay')).toBe(1);
    expect(count('xa{1,2}y', 'xaaay')).toBe(0);
    expect(count('xa{10}y', `x${'a'.repeat(10)}y`)).toBe(1);
    // A class ends at its `]`, and a `]` after it is a lone one.
    expect(count('[a]]', 'a]')).toBe(1);
  });

  it('keeps a - beside a class escape, or after a range, as a -', () => {
    expect(count(String.raw`x[\w-.]y`, 'x-y')).toBe(1);
    expect(count(String.raw`x[\w-.]y`, `x${E_ACUTE}y`)).toBe(1);
    expect(count(String.raw`x[.-\w]y`, 'x-y')).toBe(1);
    expect(count('x[a-c-e]y', 'x-y')).toBe(1);
    expect(count('x[a-c-e]y', 'xdy')).toBe(0);
    expect(count('x[a-c]y', 'xby')).toBe(1);
    expect(count('x[-a]y', 'x-y')).toBe(1);
    expect(count('x[a-]y', 'x-y')).toBe(1);
    expect(count(String.raw`x[a\-c]y`, 'xby')).toBe(0);
    expect(count(String.raw`x[\x41-\x43]y`, 'xBy')).toBe(1);
  });

  it('keeps an anchor a line, a group name and an escape what they were', () => {
    expect(count('(?<$a>x)\\k<$a>$', 'xx\nxxy\n')).toBe(1);
    expect(count('[$^]', 'a$b^c\n')).toBe(2);
    expect(count('[^]', 'ab')).toBe(2);
    expect(count('x[^]y', 'xab')).toBe(0);
    // `\b` in a class is a backspace, a character a range can start at.
    expect(count(String.raw`x[\b-z]y`, 'xAy')).toBe(1);
    expect(count(String.raw`x[\!-\/]y`, 'x#y')).toBe(1);
    // A `{` after `\B` is a character, as it is after any atom it counts nothing of.
    expect(count(String.raw`x \B{x}`, 'x {x}')).toBe(1);
    expect(count('x[]y', 'xy')).toBe(0);
    expect(count(String.raw`x[\b]y`, `x${at(8)}y`)).toBe(1);
    expect(count(String.raw`x\cAy`, `x${at(1)}y`)).toBe(1);
    expect(count(String.raw`(?<=a)b`, 'ab')).toBe(1);
  });
});

describe('what the two engines would read apart', () => {
  it('is refused, naming it', () => {
    const cases: Array<[string, string]> = [
      [String.raw`x\Ay`, String.raw`"\A" is the start of the text to ripgrep and "A" to JavaScript`],
      [String.raw`x\zy`, String.raw`"\z" is the end of the text to ripgrep and "z" to JavaScript`],
      [String.raw`a\<b`, String.raw`"\<" is the start of a word to ripgrep and "<" to JavaScript`],
      [String.raw`a\>b`, String.raw`"\>" is the end of a word to ripgrep and ">" to JavaScript`],
      [String.raw`x\ay`, String.raw`"\a" is a bell, U+0007 to ripgrep and "a" to JavaScript`],
      [String.raw`x[\a]y`, String.raw`"\a" is a bell, U+0007 to ripgrep and "a" to JavaScript`],
      [String.raw`\U00000041`, String.raw`"\U" is a code point in eight hex digits to ripgrep and "U" to JavaScript`],
      [String.raw`x[\U00000041]y`, String.raw`"\U" is a code point in eight hex digits to ripgrep and "U" to JavaScript`],
      ['xa{2, 3}y', '"{2, 3}" is a count to ripgrep, which reads one with blanks in it, and those characters to JavaScript'],
      ['xa{ 2 }y', '"{ 2 }" is a count to ripgrep, which reads one with blanks in it, and those characters to JavaScript'],
      ['xa{2,3 }y', '"{2,3 }" is a count to ripgrep, which reads one with blanks in it, and those characters to JavaScript'],
      ['xa{2, }y', '"{2, }" is a count to ripgrep, which reads one with blanks in it, and those characters to JavaScript'],
      ['xa{ 10 }y', '"{ 10 }" is a count to ripgrep, which reads one with blanks in it, and those characters to JavaScript'],
      [String.raw`x\pLy`, String.raw`"\pL" is a class of characters to ripgrep and "pL" to JavaScript`],
      [String.raw`x[\PL]y`, String.raw`"\PL" is a class of characters to ripgrep and "PL" to JavaScript`],
      [String.raw`\x{41}`, String.raw`"\x{" is the code point its braces hold to ripgrep, and an "x" and braces to JavaScript`],
      [String.raw`\b{start}foo`, String.raw`"\b{" is a word boundary of the kind its braces name to ripgrep, and a word boundary before a "{" to JavaScript`],
      ['[[:alpha:]]', '"[" in a class is a class inside it to ripgrep, as in [[:alpha:]], and a "[" to JavaScript'],
      ['x[a[b]]y', '"[" in a class is a class inside it to ripgrep, as in [[:alpha:]], and a "[" to JavaScript'],
      ['x[a&&b]y', '"&&" in a class is an operation on two classes to ripgrep and two characters to JavaScript'],
      ['x[a-z--b]y', '"--" in a class is an operation on two classes to ripgrep and two characters to JavaScript'],
      ['x[a~~b]y', '"~~" in a class is an operation on two classes to ripgrep and two characters to JavaScript'],
      ['[]a]', '"[]" before a "]" is a class holding the "]" to ripgrep, and no character to JavaScript'],
      ['[^]a]', '"[^]" before a "]" is a class holding the "]" to ripgrep, and any character to JavaScript'],
    ];
    for (const [symbol, reason] of cases) {
      expect(refusal(symbol), symbol).toBe(`Invalid regular expression: /${symbol}/: ${reason}`);
    }
  });

  it('refuses flags and a group with flags, which ripgrep reads and Node 22 does not', () => {
    const without = 'write ignore-case="true" for the whole rule, or the cases as a class, as [Aa]';
    const grouped: Array<[string, string]> = [
      ['(?i:abc)', '(?i:'],
      ['x(?-i:abc)', '(?-i:'],
      ['(?s:.)', '(?s:'],
      ['(?m:^a)', '(?m:'],
      ['(?i-s:a)', '(?i-s:'],
      ['(?-:a)', '(?-:'],
      ['(?u:a)', '(?u:'],
    ];
    for (const [symbol, flags] of grouped) {
      expect(refusal(symbol), symbol).toBe(`Invalid regular expression: /${symbol}/: "${flags}" is a group with flags to ripgrep, and to JavaScript only from Node 23, where spec-guard runs on Node 22 too: ${without}`);
    }
    const alone: Array<[string, string]> = [
      ['(?i)abc', '(?i)'],
      ['a(?x)b', '(?x)'],
      ['(?-u)a', '(?-u)'],
      ['(?ims-U)a', '(?ims-U)'],
    ];
    for (const [symbol, flags] of alone) {
      expect(refusal(symbol), symbol).toBe(`Invalid regular expression: /${symbol}/: "${flags}" sets flags for the rest of the rule to ripgrep, and is no group to JavaScript: ${without}`);
    }
    // A group with no flags, a group's name and a look-around are no flags.
    expect(count('x(?:ab)y', 'xaby')).toBe(1);
    expect(count('(?<i>a)b', 'ab')).toBe(1);
    expect(count('(?=a)a', 'a')).toBe(1);
    expect(count('(?<!b)a', 'a')).toBe(1);
    expect(count(String.raw`\(\?i\)`, '(?i)')).toBe(1);
    expect(count('[(?i)]', 'i')).toBe(1);
    expect(refusal('(?)')).toBe('Invalid regular expression: /(?)/: Invalid group');
  });

  it('names the rule, not its reading, where JavaScript refuses it', () => {
    expect(refusal('(')).toBe('Invalid regular expression: /(/: Unterminated group');
    expect(refusal('[a')).toBe('Invalid regular expression: /[a/: Unterminated character class');
    expect(refusal('x[^ab')).toBe('Invalid regular expression: /x[^ab/: Unterminated character class');
    expect(refusal(String.raw`x\ey`)).toBe(String.raw`Invalid regular expression: /x\ey/: Invalid escape`);
    expect(refusal('[z-a]')).toBe('Invalid regular expression: /[z-a]/: Range out of order in character class');
    expect(refusal('x\\')).toBe('Invalid regular expression: /x\\/: \\ at end of pattern');
    expect(refusal(String.raw`x[\B]y`)).toBe(String.raw`Invalid regular expression: /x[\B]y/: Invalid escape`);
    // An escaped character outside ASCII, from the first of them on, which
    // JavaScript read as itself without `v` and the crate refuses.
    for (const char of [at(0x80), E_ACUTE]) expect(refusal(`x\\${char}y`), char).toBe(`Invalid regular expression: /x\\${char}y/: Invalid escape`);
    expect(refusal(String.raw`\p{L`)).toBe(String.raw`Invalid regular expression: /\p{L/: Invalid property name`);
    expect(refusal('(?<abc')).toBe('Invalid regular expression: /(?<abc/: Invalid capture group name');
  });

  it('reads what is no such construct', () => {
    for (const symbol of [String.raw`\\A`, String.raw`x[\A-]`, '[^]', '[]', 'x]y', '[a-]', String.raw`[\<]`, String.raw`\p{L}`, String.raw`\bfoo`, String.raw`[&]`, String.raw`[~]`, '[a-z-]', String.raw`[\-\-]`]) {
      expect(() => buildJsRegExp(symbol, searchOptions({ regex: true })), symbol).not.toThrow(/to ripgrep/);
    }
    expect(refusal(String.raw`x[\A-]`)).toBe(String.raw`Invalid regular expression: /x[\A-]/: Invalid escape`);
  });
});

describe('a byte that is no UTF-8, as ripgrep reads its bytes', () => {
  /** How many matches a rule over a file of these bytes counts. */
  const inBytes = (symbol: string, bytes: number[], options: Partial<SearchOptions> = {}): number => count(symbol, readBytes(Buffer.from(bytes)).text, options);
  const x = 0x78;
  const y = 0x79;
  const LATIN_1_E_ACUTE = 0xe9;
  const alone = (...bytes: number[]): string => bytes.map((byte) => String.fromCharCode(0xd800 | byte)).join('');

  it('is no character to ., to a class or to a negated one, where a character between is', () => {
    for (const symbol of ['x.y', 'x[^a]y', String.raw`x\Wy`, String.raw`x\Dy`, String.raw`x\Sy`, String.raw`x\P{L}y`, String.raw`x\p{Any}y`, String.raw`x[\W]y`, String.raw`x[\s\S]y`, 'x[^]y', String.raw`x[^\w]y`]) {
      expect(inBytes(symbol, [x, LATIN_1_E_ACUTE, y]), symbol).toBe(0);
      expect(inBytes(symbol, [x, 0x2d, y]), symbol).toBe(1);
    }
    expect(inBytes('x[^a]y', [x, LATIN_1_E_ACUTE, y], { ignoreCase: true })).toBe(0);
    expect(inBytes('x.*y', [x, 0x61, LATIN_1_E_ACUTE, 0x62, y])).toBe(0);
    // A greedy run stops at the byte, and what it took before is a match.
    expect(inBytes('xa.*', [x, 0x61, 0x62, LATIN_1_E_ACUTE, 0x63])).toBe(1);
  });

  it('is no word character to \\b, and no place for \\B or word, which need a character on either side', () => {
    const foo = [0x66, 0x6f, 0x6f];
    expect(inBytes(String.raw`\bfoo`, [LATIN_1_E_ACUTE, ...foo])).toBe(1);
    expect(inBytes(String.raw`foo\b`, [...foo, LATIN_1_E_ACUTE])).toBe(1);
    expect(inBytes(String.raw`foo\B`, [...foo, LATIN_1_E_ACUTE])).toBe(0);
    expect(inBytes(String.raw`\Bfoo`, [LATIN_1_E_ACUTE, ...foo])).toBe(0);
    expect(inBytes(String.raw`\B`, [LATIN_1_E_ACUTE, LATIN_1_E_ACUTE, 0x0a])).toBe(0);
    // Two bytes it can read either side, a blank and a line end, and only those.
    expect(inBytes(String.raw` \B`, [LATIN_1_E_ACUTE, 0x20, 0x0a])).toBe(1);
    expect(inBytes(String.raw`\B `, [LATIN_1_E_ACUTE, 0x20, 0x0a])).toBe(0);
    for (const regex of [false, true]) {
      expect(inBytes('foo', [LATIN_1_E_ACUTE, ...foo, 0x20], { regex, word: true }), String(regex)).toBe(0);
      expect(inBytes('foo', [0x20, ...foo, LATIN_1_E_ACUTE], { regex, word: true }), String(regex)).toBe(0);
      expect(inBytes('foo', [0x20, ...foo, 0x20, LATIN_1_E_ACUTE], { regex, word: true }), String(regex)).toBe(1);
    }
  });

  it('ends no line', () => {
    const foo = [0x66, 0x6f, 0x6f];
    expect(inBytes('foo$', [...foo, LATIN_1_E_ACUTE, 0x0a])).toBe(0);
    // The byte is a line's text, and that line has a start.
    expect(inBytes('^', [0x61, 0x0a, LATIN_1_E_ACUTE])).toBe(2);
    expect(inBytes('^$', [LATIN_1_E_ACUTE, 0x0a])).toBe(0);
  });

  it('leaves U+FFFD written in UTF-8 the character it is', () => {
    const replacement = [0xef, 0xbf, 0xbd];
    expect(inBytes('x.y', [x, ...replacement, y])).toBe(1);
    expect(inBytes(String.raw`x\u{FFFD}y`, [x, ...replacement, y, 0xff])).toBe(1);
    expect(inBytes('x.y', [x, ...replacement, y, 0xff])).toBe(1);
  });

  it('reads each sequence Unicode calls well-formed as its character, and each other byte alone', () => {
    const cases: Array<[number[], string]> = [
      [[0x41], 'A'],
      [[0x7f], at(0x7f)],
      [[0xc2, 0x80], at(0x80)],
      [[0xc3, 0xa9], E_ACUTE],
      [[0xdf, 0xbf], at(0x7ff)],
      [[0xe0, 0xa0, 0x80], at(0x800)],
      [[0xe1, 0x80, 0x80], at(0x1000)],
      [[0xec, 0xbf, 0xbf], at(0xcfff)],
      [[0xed, 0x9f, 0xbf], at(0xd7ff)],
      [[0xee, 0x80, 0x80], at(0xe000)],
      [[0xef, 0xbf, 0xbf], at(0xffff)],
      [[0xf0, 0x90, 0x80, 0x80], at(0x10000)],
      [[0xf0, 0x9f, 0x98, 0x80], SMILE],
      [[0xf1, 0x80, 0x80, 0x80], at(0x40000)],
      [[0xf3, 0xbf, 0xbf, 0xbf], at(0xfffff)],
      [[0xf4, 0x8f, 0xbf, 0xbf], at(0x10ffff)],
      // A byte that only continues a sequence, and the leads that start none.
      [[0x80], alone(0x80)],
      [[0xbf], alone(0xbf)],
      [[0xc0, 0x80], alone(0xc0, 0x80)],
      [[0xc1, 0xbf], alone(0xc1, 0xbf)],
      [[0xf5, 0x80, 0x80, 0x80], alone(0xf5, 0x80, 0x80, 0x80)],
      [[0xff], alone(0xff)],
      // A shorter form of a character, a surrogate, and what is past U+10FFFF.
      [[0xe0, 0x9f, 0xbf], alone(0xe0, 0x9f, 0xbf)],
      [[0xed, 0xa0, 0x80], alone(0xed, 0xa0, 0x80)],
      [[0xf0, 0x8f, 0xbf, 0xbf], alone(0xf0, 0x8f, 0xbf, 0xbf)],
      [[0xf4, 0x90, 0x80, 0x80], alone(0xf4, 0x90, 0x80, 0x80)],
      // A sequence cut short, by the end of the file and by a byte it cannot hold.
      [[0xc3], alone(0xc3)],
      [[0xe2, 0x82], alone(0xe2, 0x82)],
      [[0xf0, 0x9f, 0x98], alone(0xf0, 0x9f, 0x98)],
      [[0xe2, 0x82, 0x41], `${alone(0xe2, 0x82)}A`],
      [[0xe2, 0x41, 0x82], `${alone(0xe2)}A${alone(0x82)}`],
      [[0xe2, 0xc0, 0x82], alone(0xe2, 0xc0, 0x82)],
      [[0xf0, 0x9f, 0x41, 0x80], `${alone(0xf0, 0x9f)}A${alone(0x80)}`],
      [[0xc3, 0xc3, 0xa9], `${alone(0xc3)}${E_ACUTE}`],
    ];
    for (const [bytes, text] of cases) {
      const valid = !new RegExp(String.raw`\p{Cs}`, 'v').test(text);
      expect(readBytes(Buffer.from(bytes)), bytes.join(' ')).toEqual({ text, utf8: valid });
      // With a byte that is no UTF-8 after it, the file is read a byte at a time.
      expect(readBytes(Buffer.from([...bytes, 0xff])), `${bytes.join(' ')} ff`).toEqual({ text: `${text}${alone(0xff)}`, utf8: false });
    }
    expect(readBytes(Buffer.alloc(0))).toEqual({ text: '', utf8: true });
    // A byte order mark stays a character of the first line.
    expect(readBytes(Buffer.from([0xef, 0xbb, 0xbf, 0xff]))).toEqual({ text: `${BOM}${alone(0xff)}`, utf8: false });
  });

  it('shows such a byte as U+FFFD in a line a report shows', () => {
    const text = readBytes(Buffer.from([LATIN_1_E_ACUTE, ...Buffer.from(' foo')])).text;
    const tally = scanContent(text, 'a.txt', buildJsRegExp('foo', searchOptions({})));
    expect(tally.locations.map((location) => location.text)).toEqual([`${at(0xfffd)} foo`]);
  });

  it('refuses half a character written as an escape, which ripgrep refuses and no UTF-8 holds, two halves in a row among them', () => {
    // Built, so that each escape stands in the source as an escape.
    const unit = (hex: string): string => `${'\\'}u${hex}`;
    const cases: Array<[string, string]> = [
      [`${unit('D83D')}${unit('DE00')}`, unit('D83D')],
      [`x[${unit('D83D')}${unit('DE00')}]y`, unit('D83D')],
      [`${unit('DBFF')}${unit('DFFF')}`, unit('DBFF')],
      [String.raw`\uD800`, String.raw`\uD800`],
      [String.raw`x\udfffy`, String.raw`\udfff`],
      [String.raw`x[\uDC00]y`, String.raw`\uDC00`],
      [String.raw`\uD83Dx`, String.raw`\uD83D`],
      [String.raw`\uDE00\uD83D`, String.raw`\uDE00`],
      [String.raw`\uD83D\uD83D`, String.raw`\uD83D`],
      [String.raw`\u{D800}`, String.raw`\u{D800}`],
      [String.raw`x[\u{dfff}]y`, String.raw`\u{dfff}`],
    ];
    for (const [symbol, escape] of cases) {
      expect(refusal(symbol), symbol).toBe(`Invalid regular expression: /${symbol}/: "${escape}" is half a character to JavaScript, and ripgrep refuses it: no UTF-8 text holds one, so write the whole character, as ${'\\'}u{1F600}`);
    }
    expect(count(String.raw`\u{1F600}`, `x${SMILE}y`)).toBe(1);
    expect(count(String.raw`x[\u{1F600}]y`, `x${SMILE}y`)).toBe(1);
    expect(count(`x${unit('0041')}${unit('0042')}y`, 'xABy')).toBe(1);
    expect(count(`x[${unit('0041')}-${unit('0043')}]y`, 'xBy')).toBe(1);
    expect(count(`x[${unit('0041')}-${unit('0043')}]y`, 'xDy')).toBe(0);
    // The last character before the surrogates, and the first after them.
    expect(count(`${unit('D7FF')}${unit('E000')}`, `${at(0xd7ff)}${at(0xe000)}`)).toBe(1);
    expect(count(String.raw`\u{D7FF}\u{E000}`, `${at(0xd7ff)}${at(0xe000)}`)).toBe(1);
  });
});

const rgPath = findTestRipgrep();

describe.skipIf(!rgPath)('one reading, through both engines', () => {
  // Each sample is a file of its own, and each rule is asked of each engine
  // alone, so that no other rule's match names a file ripgrep's reading of
  // this one left out.
  const SAMPLES: Record<string, string> = {
    ascii: 'x foo y',
    'e-acute-after': `x foo${E_ACUTE} y`,
    'e-acute-before': `x ${E_ACUTE}foo y`,
    mark: `x foo${MARK} y`,
    zwj: `x foo${ZWJ} y`,
    undertie: `x foo${UNDERTIE} y`,
    'circled-a': `x foo${CIRCLED_A} y`,
    'arabic-three': `x foo${ARABIC_THREE} y`,
    'superscript-two': `x foo${SUPERSCRIPT_TWO} y`,
    'roman-eight': `x foo${ROMAN_EIGHT} y`,
    bom: `x foo${BOM}bar y`,
    nel: `x foo${NEL}bar y`,
    nbsp: `x foo${NBSP}bar y`,
    smile: `x ${SMILE} y`,
    kelvin: `x ${KELVIN} y`,
    'long-s': `x ${LONG_S} y`,
    dash: 'x foo-bar y',
    'lone-a': 'a',
  };
  // Bytes that are no UTF-8, which ripgrep reads as bytes and its classes match
  // none of: a Latin-1 é after a word, alone and before one, a sequence cut
  // short, a shorter form of a character, a surrogate, past U+10FFFF, a byte
  // that only continues one, and U+FFFD written in UTF-8, which is a character.
  const BYTES: Record<string, number[]> = {
    'latin-1-after': [...Buffer.from('x foo'), 0xe9, ...Buffer.from(' y')],
    'latin-1-alone': [...Buffer.from('x '), 0xe9, ...Buffer.from(' y')],
    'latin-1-before': [...Buffer.from('x '), 0xe9, ...Buffer.from('foo y')],
    'cut-short': [...Buffer.from('x '), 0xe2, 0x82, ...Buffer.from(' y')],
    overlong: [...Buffer.from('x '), 0xc0, 0xaf, ...Buffer.from(' y')],
    surrogate: [...Buffer.from('x '), 0xed, 0xa0, 0x80, ...Buffer.from(' y')],
    'past-the-last': [...Buffer.from('x '), 0xf4, 0x90, 0x80, 0x80, ...Buffer.from(' y')],
    continuation: [...Buffer.from('x '), 0x80, ...Buffer.from(' y')],
    replacement: [...Buffer.from('x '), 0xef, 0xbf, 0xbd, ...Buffer.from(' y'), 0x0a, 0xff],
  };
  const RULES: Array<Partial<SearchOptions> & { symbol: string }> = [
    { symbol: String.raw`foo\b`, regex: true },
    { symbol: String.raw`foo\B`, regex: true },
    { symbol: String.raw`\bfoo`, regex: true },
    { symbol: String.raw`foo\w`, regex: true },
    { symbol: String.raw`foo\W`, regex: true },
    { symbol: String.raw`foo[^\w ]`, regex: true },
    { symbol: String.raw`foo[\W]`, regex: true },
    { symbol: String.raw`foo\d`, regex: true },
    { symbol: String.raw`foo\D`, regex: true },
    { symbol: String.raw`foo\sbar`, regex: true },
    { symbol: String.raw`foo\Sbar`, regex: true },
    { symbol: String.raw`foo[\s]bar`, regex: true },
    { symbol: 'x .. y', regex: true },
    { symbol: 'x . y', regex: true },
    { symbol: 'x [^a][^a] y', regex: true },
    { symbol: 'x k y', regex: true, ignoreCase: true },
    { symbol: 'x s y', regex: true, ignoreCase: true },
    { symbol: 'x [^a-z] y', regex: true, ignoreCase: true },
    { symbol: String.raw`x \W y`, regex: true, ignoreCase: true },
    { symbol: 'foo', regex: true, word: true },
    { symbol: 'foo', word: true },
    { symbol: 'foo', ignoreCase: true, word: true },
    // A byte order mark is a character of the first line to both, and an
    // empty match after the last line end is on no line.
    { symbol: BOM },
    { symbol: String.raw`^\S`, regex: true },
    { symbol: 'x*', regex: true },
    { symbol: String.raw`\B`, regex: true },
    { symbol: 'x [^a] y', regex: true },
    { symbol: String.raw`x \S y`, regex: true },
    { symbol: String.raw`x \P{L} y`, regex: true },
    { symbol: String.raw`x [\s\S]+ y`, regex: true },
    { symbol: 'foo.', regex: true },
    { symbol: 'x .* y', regex: true },
  ];

  const temporary: string[] = [];
  afterAll(async () => {
    await Promise.all(temporary.map(removeTempRepo));
  });

  it('names to the scanner every file the scanner counts in, and counts the same matches in the same places', async () => {
    const root = await makeTempRepo({
      ...Object.fromEntries(Object.entries(SAMPLES).map(([name, text]) => [`data/${name}.txt`, `${text}\n`])),
      ...Object.fromEntries(Object.entries(BYTES).map(([name, bytes]) => [`data/${name}.txt`, Buffer.from([...bytes, 0x0a])])),
      'data/starts-with-a-mark.txt': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x foo y\n')]),
      'data/empty.txt': '',
    });
    temporary.push(root);
    process.env.SPEC_GUARD_RG = rgPath as string;
    const ripgrep = await resolveEngine('ripgrep');

    const places = async (request: SearchRequest, engine: typeof javascriptEngine | typeof ripgrep): Promise<string[]> =>
      (await engine.search(request)).matches.map((match) => `${match.file}:${match.line}`);
    for (const { symbol, ...options } of RULES) {
      const request: SearchRequest = { root, symbol, targets: ['data'], options: searchOptions(options) };
      const scanner = await places(request, javascriptEngine);
      expect(await places(request, ripgrep), JSON.stringify({ symbol, options })).toEqual(scanner);
    }
  });

  it('counts what the regex crate documents, through the run', async () => {
    const root = await makeTempRepo({
      'docs/rules.md': [
        '# Rules',
        '',
        '<!-- @assert-count target="data/after.txt" symbol="foo\\b" regex="true" max="9" -->',
        '<!-- @assert-count target="data/before.txt" symbol="\\Wbar" regex="true" max="9" -->',
        '<!-- @assert-count target="data/bom.txt" symbol="a\\sb" regex="true" max="9" -->',
        '<!-- @assert-count target="data/word.txt" symbol="baz" regex="true" word="true" max="9" -->',
        '<!-- @assert-count target="data/mark.txt" symbol="cafe" word="true" max="9" -->',
        '<!-- @assert-count target="data/plain.txt" symbol="foo\\b" regex="true" max="9" -->',
        '',
      ].join('\n'),
      'data/after.txt': `foo${E_ACUTE}\n`,
      'data/before.txt': `${E_ACUTE}bar\n`,
      'data/bom.txt': `a${BOM}b\n`,
      'data/word.txt': `${E_ACUTE}baz\n`,
      'data/mark.txt': `cafe${MARK}\n`,
      'data/plain.txt': 'foo-\nfoo\n',
    });
    temporary.push(root);

    for (const engine of ['javascript', 'ripgrep'] as const) {
      process.env.SPEC_GUARD_RG = rgPath as string;
      const report = await runSpecGuard({ root, patterns: ['docs/rules.md'], engine });
      expect(report.engine, engine).toBe(engine);
      expect(report.warnings, engine).toEqual([]);
      expect(report.results.map((result) => result.actual), engine).toEqual([0, 0, 0, 0, 0, 2]);
    }
  });

  it('counts no match across a byte that is no UTF-8, and names each matching file that holds one, with either engine', async () => {
    const root = await makeTempRepo({
      'docs/rules.md': '# Rules\n\n<!-- @assert-count target="data" symbol="caf." regex="true" max="9" -->\n',
      // A Latin-1 é, which ends no match, beside a match of its own.
      'data/latin.txt': Buffer.from([...Buffer.from('caf'), 0xe9, ...Buffer.from(' cafe\n')]),
      'data/utf8.txt': `caf${E_ACUTE}\n`,
      // Matched by nothing, so not named, as ripgrep names it to no engine.
      'data/quiet.txt': Buffer.from([...Buffer.from('caf'), 0xe9, 0x0a]),
    });
    temporary.push(root);

    for (const engine of ['javascript', 'ripgrep'] as const) {
      process.env.SPEC_GUARD_RG = rgPath as string;
      const report = await runSpecGuard({ root, patterns: ['docs/rules.md'], engine });
      expect(report.engine, engine).toBe(engine);
      expect(report.results.map((result) => [result.actual, result.notUtf8Files]), engine).toEqual([[2, ['data/latin.txt']]]);
      const note = '1 matching file holds bytes that are not UTF-8, which no character of a rule matches: data/latin.txt';
      expect(formatReport(report, { color: false, verbose: true }), engine).toContain(note);
      // A passing rule's notes are said under --verbose.
      expect(formatReport(report, { color: false, verbose: false }), engine).not.toContain('not UTF-8');
      const json = JSON.parse(formatJson(report)) as { results: Array<{ notUtf8Files?: string[] }> };
      expect(json.results.map((result) => result.notUtf8Files), engine).toEqual([['data/latin.txt']]);
    }

    // A failure says it whether or not --verbose was given, as it says its other notes.
    const failing = await makeTempRepo({
      'docs/rules.md': '# Rules\n\n<!-- @assert-absence target="data" symbol="cafe" -->\n',
      'data/a.txt': Buffer.from([0xe9, ...Buffer.from(' cafe\n')]),
      'data/b.txt': Buffer.from([0xff, ...Buffer.from(' cafe\n')]),
      'data/c.txt': Buffer.from([0xfe, ...Buffer.from(' cafe\n')]),
      'data/d.txt': Buffer.from([0xc0, ...Buffer.from(' cafe\n')]),
    });
    temporary.push(failing);
    const failed = await runSpecGuard({ root: failing, patterns: ['docs/rules.md'], engine: 'javascript' });
    // The first three are named, as every note names its paths.
    expect(formatReport(failed, { color: false, verbose: false })).toContain('4 matching files hold bytes that are not UTF-8, which no character of a rule matches: data/a.txt, data/b.txt, data/c.txt\n');
  });

  it('reads a character Unicode 17.0 added as the Unicode of each engine has it, as the README says', async () => {
    // The limit the README and ADR-0007 state, through the two engines; how
    // many code points it covers, and which Node and ripgrep read which
    // Unicode, tests/unicode-version.test.ts measures and holds.
    const unicode = Number(process.versions.unicode!.split('.')[0]);
    const SIDETIC = at(0x10940); // a letter Unicode 17.0 added
    const root = await makeTempRepo({ 'data/new.txt': `a${SIDETIC}b\n`, 'data/old.txt': `a${E_ACUTE}b\n` });
    temporary.push(root);
    process.env.SPEC_GUARD_RG = rgPath as string;
    const ripgrep = await resolveEngine('ripgrep');
    const request: SearchRequest = { root, symbol: String.raw`a\wb`, targets: ['data'], options: searchOptions({ regex: true }) };
    const files = async (engine: typeof javascriptEngine | typeof ripgrep): Promise<string[]> => (await engine.search(request)).matches.map((match) => match.file);
    expect(await files(javascriptEngine)).toEqual(unicode >= 17 ? ['data/new.txt', 'data/old.txt'] : ['data/old.txt']);
    expect(await files(ripgrep)).toEqual(['data/old.txt']);
  });

  it('writes no list of such files into the JSON of a run over UTF-8', async () => {
    const root = await makeTempRepo({
      'docs/rules.md': '# Rules\n\n<!-- @assert-count target="data" symbol="cafe" max="9" -->\n',
      'data/a.txt': 'cafe\n',
    });
    temporary.push(root);
    const report = await runSpecGuard({ root, patterns: ['docs/rules.md'], engine: 'javascript' });
    expect(report.results[0]?.notUtf8Files).toEqual([]);
    expect(formatJson(report)).not.toContain('notUtf8Files');
    expect(formatReport(report, { color: false, verbose: true })).not.toContain('not UTF-8');
  });

  it('refuses a rule the two would read apart, with either engine, before it searches', async () => {
    const root = await makeTempRepo({
      'docs/rules.md': '# Rules\n\n<!-- @assert-absence target="data" symbol="x\\Ay" regex="true" -->\n',
      'data/a.txt': 'xAy\n',
    });
    temporary.push(root);

    for (const engine of ['javascript', 'ripgrep'] as const) {
      process.env.SPEC_GUARD_RG = rgPath as string;
      const report = await runSpecGuard({ root, patterns: ['docs/rules.md'], engine });
      expect(report.results, engine).toEqual([]);
      expect(report.errors.map((error) => error.message), engine).toEqual([String.raw`Invalid regular expression: /x\Ay/: "\A" is the start of the text to ripgrep and "A" to JavaScript`]);
    }
  });
});
