import { describe, it, expect } from 'vitest';
import { SYSTEM, stripFabricatedNames } from './coach.js';

// Regression guard for the 2026-07-02 name hallucination: the coach invented
// the surname "Garrett Houston" in a reply to contact "Tom Rezendes" — a name
// that appeared nowhere in the data. Two layers defend against it: an explicit
// NAMES rule in the prompt, and a post-process strip. Both are tested here.

describe('SYSTEM prompt — anti-fabrication NAMES rule', () => {
  it('tells the model to only use names present in the data', () => {
    expect(SYSTEM).toMatch(/NAMES/);
    expect(SYSTEM.toLowerCase()).toMatch(/only.*names.*(appear|present|literally)/s);
  });

  it('forbids inventing a surname / full name / business name', () => {
    const s = SYSTEM.toLowerCase();
    expect(s).toMatch(/never (invent|guess)/);
    expect(s).toMatch(/surname/);
    expect(s).toMatch(/business name/);
  });

  it('locks Garrett to a first name with no surname', () => {
    expect(SYSTEM).toMatch(/never attach a surname to him/i);
  });

  it('says to use first name only (or no name) when the surname is unknown', () => {
    expect(SYSTEM.toLowerCase()).toMatch(/first name only|no name at all/);
  });
});

describe('stripFabricatedNames — post-process safety net', () => {
  it('strips a fabricated surname invented for Garrett (the reported bug)', () => {
    const reply = "Hey Tom, would love to see you. Talk soon, Garrett Houston";
    expect(stripFabricatedNames(reply, 'Tom Rezendes'))
      .toBe("Hey Tom, would love to see you. Talk soon, Garrett");
  });

  it('leaves a bare "Garrett" sign-off untouched', () => {
    const reply = "Can't wait to work with you. Garrett";
    expect(stripFabricatedNames(reply, 'Tom Rezendes')).toBe(reply);
  });

  it('does not eat a lowercase word after Garrett (e.g. "Garrett here")', () => {
    const reply = "Hi Tom, this is Garrett here at Amari Method.";
    expect(stripFabricatedNames(reply, 'Tom Rezendes')).toBe(reply);
  });

  it('strips a guessed contact surname when only the first name is known', () => {
    const reply = "Hi Sarah Thompson, so glad you reached out.";
    // contactName is first-name-only -> surname is a guess -> strip it.
    expect(stripFabricatedNames(reply, 'Sarah')).toBe("Hi Sarah, so glad you reached out.");
  });

  it('keeps the real contact surname when it IS known (full name provided)', () => {
    const reply = "Hi Tom Rezendes, glad you reached out.";
    expect(stripFabricatedNames(reply, 'Tom Rezendes')).toBe(reply);
  });

  it('is a no-op on empty / non-string input', () => {
    expect(stripFabricatedNames('', 'Tom')).toBe('');
    expect(stripFabricatedNames(undefined, 'Tom')).toBe(undefined);
  });
});
