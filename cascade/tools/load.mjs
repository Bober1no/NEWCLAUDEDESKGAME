/* Loads the browser-global CASCADE modules into Node for headless analysis. */
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export function load(files) {
  globalThis.window = globalThis;
  for (const f of files) {
    const p = path.join(here, '..', 'js', f + '.js');
    vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: f + '.js' });
  }
  return globalThis.CSC;
}
