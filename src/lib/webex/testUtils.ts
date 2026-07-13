import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** os.tmpdir() can resolve to a relative path in some minimal sandboxes
 * (no TMPDIR/TMP/TEMP set), which would otherwise create test artifacts
 * inside the repo working directory. Always fall back to an absolute
 * path so isolated test data never lands under the repo root. */
function absoluteTmpDir(): string {
  const candidate = tmpdir();
  return path.isAbsolute(candidate) ? candidate : "/tmp";
}

/** Points LOCAL_DATA_DIR at a fresh temp directory for the duration of a
 * test, so Webex store tests never touch the real .data/webex/ directory
 * and never leak state between tests. Call the returned cleanup function
 * in afterEach. */
export function useIsolatedDataDir(): { cleanup: () => void } {
  const dir = mkdtempSync(path.join(absoluteTmpDir(), "webex-test-"));
  const previous = process.env.LOCAL_DATA_DIR;
  process.env.LOCAL_DATA_DIR = dir;
  return {
    cleanup: () => {
      process.env.LOCAL_DATA_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
