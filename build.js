const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const source = path.join(root, "public");
const output = path.join(root, "dist");

fs.mkdirSync(output, { recursive: true });

for (const entry of fs.readdirSync(output)) {
  fs.rmSync(path.join(output, entry), { recursive: true, force: true });
}

fs.cpSync(source, output, { recursive: true });
console.log(`Built ${fs.readdirSync(output).length} static files.`);
