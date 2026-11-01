import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { type Plugin, transformWithOxc } from "vite";

const SOURCE = path.resolve(import.meta.dirname, "src/sw.ts");

/**
 * Builds src/sw.ts into sw.js with the list of files to precache and a hash of their contents, so
 * every build that changes a file installs a new worker and drops the old cache.
 */
export function serviceWorker(): Plugin {
  let publicDir = "";
  return {
    name: "sure-quick-entry:service-worker",
    apply: "build",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle: {
      // index.html joins the bundle in Vite's own generateBundle.
      order: "post",
      async handler(_, bundle) {
        const files = new Map<string, string | Uint8Array>();
        for (const [name, item] of Object.entries(bundle)) {
          if (!name.endsWith(".map"))
            files.set(name, item.type === "chunk" ? item.code : item.source);
        }
        // Vite copies public/ after the bundle is written, so those files are read from disk.
        if (publicDir) {
          for (const entry of await readdir(publicDir, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile()) continue;
            const file = path.join(entry.parentPath, entry.name);
            files.set(
              path.relative(publicDir, file).split(path.sep).join("/"),
              await readFile(file),
            );
          }
        }

        // Paths relative to sw.js, which sits at the base, so the build works under any base.
        const precache = [...files.keys()].sort();
        const hash = createHash("sha256");
        for (const name of precache) hash.update(name).update(files.get(name)!);
        const version = hash.digest("hex").slice(0, 12);

        const { code } = await transformWithOxc(await readFile(SOURCE, "utf8"), SOURCE, {
          lang: "ts",
        });
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `const PRECACHE = ${JSON.stringify(precache)};\nconst VERSION = "${version}";\n${code}`,
        });
      },
    },
  };
}
