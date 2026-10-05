import { mkdtemp, mkdir, cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { assert, config, pkg, validateConfig, readManifest, websiteURL, root } from "./config";
import { checksum, verifyRelease } from "./verify";
import { stageSite } from "./site";

validateConfig();
assert(process.env.GITHUB_REPOSITORY === config.repository && process.env.GITHUB_REF === `refs/tags/v${pkg.version}` && process.env.GITHUB_EVENT_NAME === "push", "Publish only from a matching version tag in the application repository");
assert(process.env.GH_TOKEN, "Missing GitHub token");
const bundle = resolve(process.argv[2]!), site = resolve(process.argv[3]!);
const tag = `v${pkg.version}`;
const temporary = await mkdtemp(join(tmpdir(), "malatang-publish-"));
async function run(command: string[], cwd?: string, env?: Record<string, string>) {
  const child = Bun.spawn(command, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  assert(await child.exited === 0, `Command ${command[0]} failed: ${stderr}`);
  return stdout.trim();
}
const gh = (...args: string[]) => run(["gh", ...args]);
// Token is passed through process environment, never written to git config or the site.
const gitEnv = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: "AUTHORIZATION: basic " + Buffer.from("x-access-token:" + process.env.GH_TOKEN).toString("base64") };
try {
  const updateDirectory = join(temporary, "update"); await mkdir(updateDirectory);
  await run(["tar", "-xzf", join(bundle, "updates.tar.gz"), "-C", updateDirectory]);
  const manifest = await verifyRelease(updateDirectory);
  // Recover the complete previous Pages snapshot. A failed API call must never mean an empty history.
  const refResult = await gh("api", `repos/${config.repository}/git/matching-refs/heads/gh-pages`);
  const refs = JSON.parse(refResult) as { ref: string }[];
  await mkdir(site, { recursive: true });
  await run(["git", "init", "-b", "gh-pages"], site);
  await run(["git", "remote", "add", "origin", `https://github.com/${config.repository}.git`], site);
  if (refs.some(ref => ref.ref === "refs/heads/gh-pages")) {
    await run(["git", "fetch", "--depth=1", "origin", "gh-pages"], site, gitEnv);
    await run(["git", "reset", "--hard", "FETCH_HEAD"], site);
  }
  await stageSite(updateDirectory, site); // Monotonic feed / immutable build checks run BEFORE any release mutation.
  const releases = JSON.parse(await gh("api", "--paginate", "--slurp", `repos/${config.repository}/releases?per_page=100`)).flat() as { id: number; tag_name: string; draft: boolean; assets: { name: string }[] }[];
  let release = releases.find(r => r.tag_name === tag);
  const dmg = `Malatang-${pkg.version}-${config.build}-mac-arm64.dmg`;
  const names = [dmg, dmg + ".sha256", dmg + ".report.json", "updates.tar.gz", "latest.json"];
  await cp(join(updateDirectory, "latest.json"), join(bundle, "latest.json"));
  const expectedDMG = (await Bun.file(join(bundle, dmg + ".sha256")).text()).split(/\s/)[0];
  assert(await checksum(join(bundle, dmg)) === expectedDMG, "Installer DMG checksum mismatch");
  const report = await Bun.file(join(bundle, dmg + ".report.json")).json();
  assert(report.ok === true, "Installer smoke check did not pass");
  if (release && !release.draft) {
    // Retry a failed Pages deployment using its existing immutable release payload, never overwrite assets.
    await gh("release", "download", tag, "--repo", config.repository, "--pattern", "latest.json", "--dir", temporary);
    const published = readManifest(await Bun.file(join(temporary, "latest.json")).text());
    assert(JSON.stringify(published) === JSON.stringify(manifest), "Published tag has different update contents; create a new version");
    for (const name of names) assert(release.assets.some(a => a.name === name), "Published release is incomplete: " + name);
  } else {
    if (!release) {
      const notes = `macOS 14+ / Apple Silicon。应用和 DMG 已使用 Developer ID 签名，DMG 已通过 Apple 公证并附带公证票据。\n\n[麻辣烫官网](${websiteURL}) · [下载与安装](${config.downloadURL})\n\n下载并打开 .dmg，将 Malatang.app 拖入 Applications，然后从“应用程序”启动。\n\n应用启动时和每 24 小时检查更新，确认后安装。原生运行时变更时请下载完整 DMG 安装包。\n\nBuild ${config.build}`;
      const changes = Bun.file(join(root, "release/notes", `${pkg.version}.md`));
      const notesPath = join(temporary, "notes.txt"); await Bun.write(notesPath, notes + ((await changes.exists()) ? "\n\n" + await changes.text() : ""));
      await gh("release", "create", tag, "--repo", config.repository, "--verify-tag", "--draft", "--title", `Malatang ${pkg.version}`, "--notes-file", notesPath);
    }
    // Draft assets are replaceable until the release becomes visible.
    await gh("release", "upload", tag, "--repo", config.repository, "--clobber", ...names.map(name => join(bundle, name)));
    await gh("release", "edit", tag, "--repo", config.repository, "--draft=false", "--latest");
  }
  await run(["git", "add", "."], site);
  const changes = await run(["git", "status", "--porcelain"], site);
  if (changes) {
    await run(["git", "-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "-m", `Publish Malatang ${pkg.version} (${config.build})`], site);
    await run(["git", "push", "origin", "HEAD:gh-pages"], site, gitEnv);
  }
  await rm(join(site, ".git"), { recursive: true, force: true });
  console.log(`Release ${tag} published; preserved update history is ready for Pages deployment.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
