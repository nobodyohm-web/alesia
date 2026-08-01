import { readFileSync } from 'fs';
import matter from 'gray-matter';
import type { Skill, SkillSource } from './types.js';

// gray-matter picks the front matter language from the text right after the
// opening `---`, and its built-in `javascript` engine parses via eval(). A
// SKILL.md starting with `---js` would therefore run arbitrary code at
// discovery time. Only YAML is ever legitimate here, so reject anything else
// before parsing, and neutralise the code-executing engines as a second layer.
const ALLOWED_FRONTMATTER_LANGUAGES = new Set(['', 'yaml', 'yml']);

const REJECTED_ENGINE = {
  parse: (): never => {
    throw new Error('Only YAML frontmatter is supported in SKILL.md files');
  },
  stringify: (): never => {
    throw new Error('Only YAML frontmatter is supported in SKILL.md files');
  },
};

const MATTER_OPTIONS = {
  language: 'yaml',
  engines: {
    javascript: REJECTED_ENGINE,
    js: REJECTED_ENGINE,
    coffee: REJECTED_ENGINE,
    coffeescript: REJECTED_ENGINE,
  },
};

/**
 * Parse SKILL.md front matter, refusing any non-YAML front matter language.
 *
 * @throws Error if the file declares a front matter language other than YAML
 */
function parseFrontmatter(content: string, path: string): matter.GrayMatterFile<string> {
  const declared = matter.language(content).name.trim().toLowerCase();
  if (!ALLOWED_FRONTMATTER_LANGUAGES.has(declared)) {
    throw new Error(
      `Skill at ${path} declares unsupported frontmatter language '${declared}'; only YAML is allowed`,
    );
  }
  return matter(content, MATTER_OPTIONS);
}

/**
 * Parse a SKILL.md file content into a Skill object.
 * Extracts YAML frontmatter (name, description) and the markdown body (instructions).
 *
 * @param content - Raw file content
 * @param path - Absolute path to the file (for reference)
 * @param source - Where this skill came from
 * @returns Parsed Skill object
 * @throws Error if required frontmatter fields are missing
 */
export function parseSkillFile(content: string, path: string, source: SkillSource): Skill {
  const { data, content: instructions } = parseFrontmatter(content, path);

  // Validate required frontmatter fields
  if (!data.name || typeof data.name !== 'string') {
    throw new Error(`Skill at ${path} is missing required 'name' field in frontmatter`);
  }
  if (!data.description || typeof data.description !== 'string') {
    throw new Error(`Skill at ${path} is missing required 'description' field in frontmatter`);
  }

  return {
    name: data.name,
    description: data.description,
    path,
    source,
    instructions: instructions.trim(),
  };
}

/**
 * Load a skill from a file path.
 *
 * @param path - Absolute path to the SKILL.md file
 * @param source - Where this skill came from
 * @returns Parsed Skill object
 * @throws Error if file cannot be read or parsed
 */
export function loadSkillFromPath(path: string, source: SkillSource): Skill {
  const content = readFileSync(path, 'utf-8');
  return parseSkillFile(content, path, source);
}

/**
 * Extract just the metadata from a skill file without loading full instructions.
 * Used for lightweight discovery at startup.
 *
 * @param path - Absolute path to the SKILL.md file
 * @param source - Where this skill came from
 * @returns Skill metadata (name, description, path, source)
 */
export function extractSkillMetadata(path: string, source: SkillSource): { name: string; description: string; path: string; source: SkillSource } {
  const content = readFileSync(path, 'utf-8');
  const { data } = parseFrontmatter(content, path);

  if (!data.name || typeof data.name !== 'string') {
    throw new Error(`Skill at ${path} is missing required 'name' field in frontmatter`);
  }
  if (!data.description || typeof data.description !== 'string') {
    throw new Error(`Skill at ${path} is missing required 'description' field in frontmatter`);
  }

  return {
    name: data.name,
    description: data.description,
    path,
    source,
  };
}
