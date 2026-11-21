import { copyFileSync, existsSync, writeFileSync } from "node:fs";

const dir = "dist/client";
const index = `${dir}/index.html`;
if (!existsSync(index)) {
  console.error(`pages: missing ${index}`);
  process.exit(1);
}
copyFileSync(index, `${dir}/404.html`);
writeFileSync(`${dir}/.nojekyll`, "");
console.log("pages: dist/client is ready (index.html, 404.html, .nojekyll)");
