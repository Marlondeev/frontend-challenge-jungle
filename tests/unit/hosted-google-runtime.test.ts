import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import googleAuth from "../../api/google-auth";

it("loads and serves the emitted function with native Node ESM resolution", () => {
  const temporaryRoot = resolve("tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(join(temporaryRoot, "hosted-google-esm-"));
  try {
    for (const file of [
      "api/google-auth.ts",
      "config/google-client.ts",
      "server/hosted-google-auth.ts",
      "server/google-token.ts",
      "src/mocks/backend.ts",
      "src/mocks/fixtures.ts",
      "src/mocks/storage-coordinator.ts",
    ]) {
      const target = join(directory, file.replace(/\.ts$/, ".js"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(
        target,
        ts.transpileModule(readFileSync(file, "utf8"), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
      );
    }
    const script = `
      import assert from 'node:assert/strict';
      import {createServer} from 'node:http';
      const {default:handler}=await import(process.env.KURIO_ESM_ENTRY);
      const server=createServer((req,res)=>{void handler(req,res);});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const origin='http://127.0.0.1:'+server.address().port;
      try {
        const challenge=await fetch(origin+'/api/google-auth');
        assert.equal(challenge.status,200);
        const {nonce}=await challenge.json();
        assert.equal(typeof nonce,'string');
        const rejected=await fetch(origin+'/api/google-auth',{
          method:'POST',
          headers:{Origin:origin,Cookie:challenge.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'},
          body:JSON.stringify({nonce,credential:'unsigned-test-token'})
        });
        assert.equal(rejected.status,401);
        assert.equal((await rejected.json()).code,'INVALID_CREDENTIALS');
        console.log('native-node-handler-ok');
      } finally {
        server.closeAllConnections();
        await new Promise(resolve=>server.close(resolve));
      }
    `;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          KURIO_ESM_ENTRY: pathToFileURL(join(directory, "api/google-auth.js"))
            .href,
        },
      },
    );
    expect(output).toContain("native-node-handler-ok");
  } finally {
    // Delete only the exact temporary child allocated above, inside this workspace.
    if (dirname(resolve(directory)) === temporaryRoot)
      rmSync(directory, { recursive: true, force: true });
  }
});

it("serves the public-ID runtime adapter and rejects an unsigned credential without a network request", async () => {
  const server = createServer((req, res) => {
    void googleAuth(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${origin}/api/google-auth`);
    expect(response.status).toBe(200);
    const { nonce } = (await response.json()) as { nonce: string };
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const rejected = await fetch(`${origin}/api/google-auth?bypass=true`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ credential: "unsigned-id-token", nonce }),
    });
    expect(rejected.status).toBe(401);
    expect((await rejected.json()).code).toBe("INVALID_CREDENTIALS");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
