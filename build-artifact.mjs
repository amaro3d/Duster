// Gera uma versão "fragmento" do jogo para publicar como Artifact (sem doctype/head/body).
import fs from 'node:fs';
const html = fs.readFileSync('dist/index.html', 'utf8');
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const out = `<title>ONDA Surf</title>
<style>
:root{color-scheme:dark}
html,body{height:100%;background:#04121c}
${style}
</style>
${body}`;
const dest = process.argv[2] || 'dist/artifact.html';
fs.writeFileSync(dest, out);
console.log(dest, (out.length / 1024).toFixed(0) + ' KB');
