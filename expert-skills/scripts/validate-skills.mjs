#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(scriptDir, '..', 'skills');
const skillFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(entryPath);
    if (entry.isFile() && entry.name === 'SKILL.md') skillFiles.push(entryPath);
  }
}

function fail(message) {
  console.error(`Skill validation failed: ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(skillsRoot)) {
  fail(`missing skills root: ${skillsRoot}`);
} else {
  walk(skillsRoot);
}

const seenNames = new Set();
for (const skillFile of skillFiles.sort()) {
  const relativeFile = path.relative(skillsRoot, skillFile);
  const source = fs.readFileSync(skillFile, 'utf8');
  const frontmatterMatch = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);
  if (!frontmatterMatch) {
    fail(`${relativeFile} must have closed YAML frontmatter and a non-empty body`);
    continue;
  }

  const frontmatter = frontmatterMatch[1];
  const keys = [...frontmatter.matchAll(/^([A-Za-z0-9_-]+):/gm)].map((match) => match[1]);
  const unexpectedKeys = keys.filter((key) => !['name', 'description'].includes(key));
  if (unexpectedKeys.length > 0) {
    fail(`${relativeFile} has unsupported frontmatter keys: ${unexpectedKeys.join(', ')}`);
  }

  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || '';
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() || '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    fail(`${relativeFile} has an invalid name: ${name || '<empty>'}`);
  }
  if (!description || description.length > 1024) {
    fail(`${relativeFile} description must contain 1-1024 characters`);
  }
  if (seenNames.has(name)) {
    fail(`${relativeFile} duplicates Skill name: ${name}`);
  }
  seenNames.add(name);

  const directoryName = path.basename(path.dirname(skillFile));
  if (directoryName !== name) {
    fail(`${relativeFile} directory name must match Skill name ${name}`);
  }

  const linkedReferences = [...source.matchAll(/`(references\/[^`]+)`/g)].map((match) => match[1]);
  for (const linkedReference of new Set(linkedReferences)) {
    const referencePath = path.resolve(path.dirname(skillFile), linkedReference);
    const relativeToSkill = path.relative(path.dirname(skillFile), referencePath);
    if (relativeToSkill.startsWith('..') || path.isAbsolute(relativeToSkill)) {
      fail(`${relativeFile} has an unsafe reference path: ${linkedReference}`);
    } else if (!fs.existsSync(referencePath)) {
      fail(`${relativeFile} links missing file: ${linkedReference}`);
    }
  }
}

if (skillFiles.length === 0) {
  fail(`no SKILL.md files found under ${skillsRoot}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`Validated ${skillFiles.length} expert Skills.`);
