// The view buttons hold their place while editing actions enter and leave the floating bar.

import vm from 'node:vm';
import { check, record } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  check('Save arriving and leaving does not move the view buttons', () => {
    const toolbar = booted.document.getElementById('readerToolbar');
    const viewGroup = toolbar.querySelector('.reader-tool-group');
    const wasComputedStyle = booted.getComputedStyle;
    let writes = 0;
    const setProperty = toolbar.style.setProperty.bind(toolbar.style);
    toolbar.style.setProperty = (name, value) => {
      writes += 1;
      setProperty(name, value);
    };
    booted.getComputedStyle = () => ({ paddingRight: '8px' });
    viewGroup.getBoundingClientRect = () => ({ right: 220 });
    try {
      vm.runInContext("currentState = { tabs: [{ path: 'notes.md' }], active: 0 }; dirtyByPath.clear(); undoableByPath.clear(); redoableByPath.clear();", booted);
      toolbar.getBoundingClientRect = () => ({ right: 300 });
      booted.setDirtyState('notes.md', true);
      if (toolbar.style.getPropertyValue('--reader-toolbar-edits') !== '72px') {
        throw new Error(`Save left an offset of ${toolbar.style.getPropertyValue('--reader-toolbar-edits') || 'nothing'}`);
      }
      const afterSave = writes;
      booted.holdViewButtonsStill();
      if (writes !== afterSave) throw new Error('an unchanged editing half was written again');

      toolbar.getBoundingClientRect = () => ({ right: 228 });
      booted.setDirtyState('notes.md', false);
      if (toolbar.style.getPropertyValue('--reader-toolbar-edits') !== '0px') {
        throw new Error(`an empty editing half left ${toolbar.style.getPropertyValue('--reader-toolbar-edits') || 'nothing'} reserved`);
      }
    } finally {
      booted.getComputedStyle = wasComputedStyle;
      toolbar.style.setProperty = setProperty;
      vm.runInContext('currentState = null; dirtyByPath.clear(); undoableByPath.clear(); redoableByPath.clear();', booted);
    }
  });
}
