const fs = require("node:fs");
const path = require("node:path");

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const source = path.join(__dirname, "..", "src-tauri", "target", "release", "cursor-light.exe");
const outDir = path.join(__dirname, "..", "dist");
const target = path.join(outDir, `Cursor Light-${pkg.version}-x64-portable.exe`);
const fallbackTarget = path.join(outDir, `Cursor Light-${pkg.version}-x64-portable-new.exe`);

if (!fs.existsSync(source)) {
  throw new Error(`Missing Tauri release executable: ${source}`);
}

fs.mkdirSync(outDir, { recursive: true });

for (const entry of fs.readdirSync(outDir)) {
  const entryPath = path.join(outDir, entry);
  try {
    fs.rmSync(entryPath, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EBUSY") {
      throw error;
    }
    console.warn(`Kept locked file ${path.relative(process.cwd(), entryPath)}`);
  }
}

try {
  fs.copyFileSync(source, target);
  console.log(`Copied ${path.relative(process.cwd(), target)}`);
} catch (error) {
  if (error.code !== "EPERM" && error.code !== "EBUSY") {
    throw error;
  }
  fs.copyFileSync(source, fallbackTarget);
  console.log(`Copied ${path.relative(process.cwd(), fallbackTarget)}`);
  console.warn("Close the running app before replacing the locked portable exe.");
}
