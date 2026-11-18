import { build } from 'esbuild';
import fs from 'node:fs';
const r = await build({ entryPoints: ['src/main.js'], bundle: true, minify: process.argv.includes('--min'), format: 'iife', write: false, target: 'es2020', logLevel: 'info' });
const js = r.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>');
const html = fs.readFileSync('src/index.html', 'utf8').replace('<!--BUNDLE-->', () => `<script>${js}</script>`);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
