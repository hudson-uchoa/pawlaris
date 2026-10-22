// A deliberately small, fail-closed check of Maestro selector syntax. It
// inspects selector blocks at every indentation, including nested flows.
// It is not a general YAML parser; aliases and flow-style selector maps are
// rejected so they cannot conceal a selector from the check.
export function selectorProblems(yaml) {
  const problems = [], selectors = [];
  const selectorKey = /^(?:tapOn|longPressOn|doubleTapOn|assertVisible|assertNotVisible|copyTextFrom|visible|notVisible|element|above|below|leftOf|rightOf|containsChild|containsDescendants|childOf|insideOf|notContainsChild)$/;
  const lines = yaml.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^(\s*)(?:-\s+)?["']?([\w]+)["']?:(?:\s*(.*))?$/.exec(line);
    if (!match) continue;
    const [, whitespace, key, rest = ''] = match;
    const indent = whitespace.length + (line.trimStart().startsWith('- ') ? 2 : 0);
    while (selectors.length && indent <= selectors.at(-1).indent) {
      const block = selectors.pop();
      if (!block.hasId) problems.push(`line ${block.line}: selector requires id`);
    }
    if (key === 'text' || /[&*][\w-]+/.test(rest) && !rest.includes('${')) {
      problems.push(`line ${index + 1}: text selectors and YAML aliases are forbidden`);
    }
    if (selectorKey.test(key)) {
      if (rest && !rest.startsWith('#')) problems.push(`line ${index + 1}: use an id selector block`);
      else selectors.push({ indent, line: index + 1, hasId: false });
    }
    if (key === 'id' && rest.trim() && selectors.length) selectors.at(-1).hasId = true;
  }
  for (const block of selectors) if (!block.hasId) problems.push(`line ${block.line}: selector requires id`);
  return problems;
}
