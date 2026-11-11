// Minimal typings for the Node APIs used by vite.config.ts, so the web package
// does not need @types/node.
declare module 'node:child_process' {
  export function execSync(
    command: string,
    options: { encoding: 'utf8'; stdio: string[] },
  ): string;
}

declare const process: { env: Record<string, string | undefined> };
