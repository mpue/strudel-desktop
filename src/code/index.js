// Bündelt die Code-Hilfen und bindet sie an die Einstellungsschalter von StrudelMirror.
import { StateEffect } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { createAssist } from './assist.js';
import { strudelAutocomplete } from './completion.js';
import { signatureHelp, strudelHover, tooltipTheme, wordAtCursor } from './hover.js';
import { miniHighlight } from './mini-highlight.js';
import { strudelLinter } from './lint.js';

export function createCodeExtensions(actions) {
  const hover = strudelHover(actions);
  const assist = createAssist(actions);
  return {
    assist,
    toggles: {
      isAutoCompletionEnabled: (on) => (on ? strudelAutocomplete : []),
      isTooltipEnabled: (on) => (on ? [hover, signatureHelp, tooltipTheme] : []),
    },
    append: StateEffect.appendConfig.of([
      miniHighlight,
      strudelLinter,
      assist.extension,
      keymap.of([
        {
          key: 'F1',
          preventDefault: true,
          run: (view) => {
            actions.openReference(wordAtCursor(view));
            return true;
          },
        },
      ]),
    ]),
  };
}
