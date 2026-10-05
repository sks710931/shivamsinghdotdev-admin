import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "tinymce");
const target = join(root, "public", "tinymce");

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

for (const name of ["tinymce.min.js", "icons", "models", "plugins", "skins", "themes"]) {
  cpSync(join(source, name), join(target, name), { recursive: true });
}
