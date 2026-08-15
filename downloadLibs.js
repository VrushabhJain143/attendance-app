const fs = require('fs');
const path = require('path');

// Target directory paths
const rootDir = __dirname;
const publicDir = path.join(rootDir, 'public');
const libDir = path.join(publicDir, 'lib');
const uploadsDir = path.join(rootDir, 'uploads');

// Ensure directories exist
console.log('Creating directories...');
[publicDir, libDir, uploadsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

// Download helper
async function downloadFile(url, dest) {
  console.log(`Downloading ${url} to ${dest}...`);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(arrayBuffer));
    console.log(`Download complete: ${dest}`);
  } catch (error) {
    console.error(`Error downloading file from ${url}:`, error.message);
    process.exit(1);
  }
}

async function main() {
  const xlsxUrl = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  const destPath = path.join(libDir, 'xlsx.full.min.js');
  await downloadFile(xlsxUrl, destPath);
  console.log('Setup and downloads completed successfully!');
}

main();
