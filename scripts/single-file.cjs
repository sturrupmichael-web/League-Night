// Turns the Vite build in dist/ into one self-contained HTML body for a claude.ai artifact.
const fs = require('fs'); const path = require('path');
const dist = process.argv[2], out = process.argv[3];
const a = path.join(dist, 'assets'); const files = fs.readdirSync(a);
const js = fs.readFileSync(path.join(a, files.find(f => f.endsWith('.js'))), 'utf8');
const css = fs.readFileSync(path.join(a, files.find(f => f.endsWith('.css'))), 'utf8');
if (/<\/script/i.test(js)) throw new Error('script contains </script');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim();
const page = `<title>League Night</title>
<meta name="theme-color" content="#14111c">
<style>
:root { color-scheme: dark; }
${css}
</style>
${body}
<script type="module">
${js}
</script>
`;
fs.writeFileSync(out, page);
console.log('wrote', out, page.length, 'bytes');
