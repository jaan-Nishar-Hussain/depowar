import fs from 'node:fs';
import path from 'node:path';
import type { Abi, Hex } from 'viem';

const OUT_DIR = path.resolve(__dirname, '..', 'out');

export interface Artifact {
  abi: Abi;
  bytecode: Hex;
}

function findFile(dir: string, fileName: string): string | undefined {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, fileName);
      if (found) return found;
    } else if (entry.name === fileName) {
      return full;
    }
  }
  return undefined;
}

interface FoundryArtifact {
  abi: unknown;
  bytecode: string | { object: string };
}

/**
 * Loads a Foundry build artifact by contract name. Searches the forge `out/`
 * directory recursively so source layout changes don't break resolution.
 */
export function readArtifact(contractName: string): Artifact {
  const file = findFile(OUT_DIR, `${contractName}.json`);
  if (!file) {
    throw new Error(
      `Foundry artifact "${contractName}" not found in ${OUT_DIR}. ` +
        'Run `forge build` (or `pnpm --filter @paymesh/contracts build`) first.',
    );
  }
  const artifact = require(file) as FoundryArtifact;
  const bytecode =
    typeof artifact.bytecode === 'string' ? artifact.bytecode : artifact.bytecode.object;
  return { abi: artifact.abi as Abi, bytecode: bytecode as Hex };
}