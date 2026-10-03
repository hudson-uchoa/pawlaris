import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unreferencedTodos } from './guard-todo.mjs';

const todo = 'TO' + 'DO';
const fixme = 'FIX' + 'ME';
const diff = (line) => `diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n` +
  `@@ -0,0 +1 @@\n+${line}\n`;

test('P0-8: reject either added marker without a numeric issue', () => {
  for (const marker of [todo, fixme]) {
    for (const suffix of ['', ' #3', ' (#abc)', ' (#)', ' (#3x)']) {
      assert.deepEqual(unreferencedTodos('src/file.ts', diff(`// ${marker}${suffix}`)), [1]);
    }
    assert.deepEqual(unreferencedTodos('src/file.ts', diff(`// ${marker} (#123)`)), []);
  }
});

test('P0-8: inspect only added lines with markers as whole words', () => {
  assert.deepEqual(unreferencedTodos('file.py', `@@ -1,2 +1,2 @@\n-${todo}\n ${fixme}\n+done\n`), []);
  assert.deepEqual(unreferencedTodos('file.mjs', diff(`${todo}_VALUE`)), []);
  assert.deepEqual(unreferencedTodos('file.ts', `@@ -2 +2 @@\n-old\n+${todo}\n` +
    `@@ -9 +9,2 @@\n-old\n+done\n+${fixme}\n`), [2, 10]);
});

test('P0-8: exclude Markdown and spec while checking the project code languages', () => {
  for (const path of ['docs/note.md', 'spec/sample.ts', 'file.json', 'file.png']) {
    assert.deepEqual(unreferencedTodos(path, diff(todo)), []);
  }
  for (const extension of ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'sh', 'ps1', 'sql']) {
    assert.deepEqual(unreferencedTodos(`file.${extension}`, diff(todo)), [1]);
  }
});
