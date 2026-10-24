import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
await build({entryPoints:[path.join(root,'main.js')],outfile:path.join(root,'bundle.js'),bundle:true,format:'iife',target:'safari17',loader:{'.jpg':'dataurl'},logLevel:'info'});
