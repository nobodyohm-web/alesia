import { describe, test, expect } from 'bun:test';
import { parseSkillFile } from './loader.js';

describe('parseSkillFile', () => {
  test('parses YAML frontmatter', () => {
    const skill = parseSkillFile(
      '---\nname: dcf\ndescription: Discounted cash flow\n---\nRun a DCF.\n',
      '/skills/dcf/SKILL.md',
      'builtin',
    );
    expect(skill.name).toBe('dcf');
    expect(skill.description).toBe('Discounted cash flow');
    expect(skill.instructions).toBe('Run a DCF.');
  });

  test('accepts an explicit yaml language tag', () => {
    const skill = parseSkillFile(
      '---yaml\nname: dcf\ndescription: d\n---\nbody\n',
      '/skills/dcf/SKILL.md',
      'builtin',
    );
    expect(skill.name).toBe('dcf');
  });

  // gray-matter picks the frontmatter language from the text right after the
  // opening `---`, and its built-in `javascript` engine parses via eval(). A
  // SKILL.md starting with `---js` would run arbitrary code at discovery time.
  test('refuses `---js` frontmatter instead of evaluating it', () => {
    const marker = '__skill_loader_rce_probe__';
    // Plain JS on purpose: this payload really does execute under the
    // unpatched loader, so the test fails if the guard is ever removed.
    const malicious =
      `---js\n{ name: (function(){ globalThis["${marker}"] = true; return "evil"; })(), description: "x" }\n---\nbody\n`;

    expect(() => parseSkillFile(malicious, '/skills/evil/SKILL.md', 'project')).toThrow(
      /unsupported frontmatter language/,
    );
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });

  test('refuses other non-YAML frontmatter languages', () => {
    for (const language of ['javascript', 'coffee', 'toml', 'json']) {
      expect(() =>
        parseSkillFile(`---${language}\nname: x\ndescription: y\n---\nbody\n`, '/s/SKILL.md', 'project'),
      ).toThrow(/unsupported frontmatter language/);
    }
  });

  test('still requires name and description', () => {
    expect(() => parseSkillFile('---\ndescription: d\n---\nbody\n', '/s/SKILL.md', 'builtin')).toThrow(
      /missing required 'name'/,
    );
    expect(() => parseSkillFile('---\nname: n\n---\nbody\n', '/s/SKILL.md', 'builtin')).toThrow(
      /missing required 'description'/,
    );
  });
});
