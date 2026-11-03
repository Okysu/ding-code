import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import githubLight from '@shikijs/themes/github-light';
import githubDark from '@shikijs/themes/github-dark';
import typescript from '@shikijs/langs/typescript';
import javascript from '@shikijs/langs/javascript';
import python from '@shikijs/langs/python';
import json from '@shikijs/langs/json';
import bash from '@shikijs/langs/bash';
import sql from '@shikijs/langs/sql';
import html from '@shikijs/langs/html';

// Share grammars and compiled regexes across the gallery's code cards.
export const highlighter = createHighlighterCore({
  themes: [githubLight, githubDark],
  langs: [typescript, javascript, python, json, bash, sql, html],
  engine: createJavaScriptRegexEngine(),
});
