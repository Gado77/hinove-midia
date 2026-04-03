const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'frontend');
const distDir = path.join(srcDir, 'dist');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.name.endsWith('.html') || entry.name.endsWith('.js') || entry.name.endsWith('.css')) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function processHtml(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  content = content.replace(/href="\//g, 'href="./');
  content = content.replace(/src="\//g, 'src="./');
  
  fs.writeFileSync(filePath, content);
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else if (entry.name.endsWith('.html')) {
      processHtml(fullPath);
    }
  }
}

if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true });
copyDir(srcDir, distDir);
walkDir(distDir);

console.log('Build statico concluído!');
