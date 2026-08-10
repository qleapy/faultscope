import { Sandbox } from "@vercel/sandbox";

const revision = process.env.FAULTSCOPE_CLI_REVISION;
const rustupSha256 = "4acc9acc76d5079515b46346a485974457b5a79893cfb01112423c89aeb5aa10";
if (!revision || !/^[0-9a-f]{40}$/.test(revision)) {
  throw new Error("FAULTSCOPE_CLI_REVISION must be a full Git commit SHA");
}

const sandbox = await Sandbox.create({
  source: {
    type: "git",
    url: "https://github.com/qleapy/faultscope.git",
    revision,
    depth: 1,
  },
  timeout: 45 * 60 * 1_000,
  resources: { vcpus: 4 },
  networkPolicy: "allow-all",
});

try {
  const compiler = await sandbox.runCommand({
    cmd: "dnf",
    args: ["install", "-y", "--setopt=install_weak_deps=False", "gcc"],
    sudo: true,
    timeoutMs: 10 * 60 * 1_000,
  });
  if (compiler.exitCode !== 0) throw new Error((await compiler.stderr()).trim() || "System compiler installation failed");
  await sandbox.update({
    networkPolicy: {
      allow: ["static.rust-lang.org", "index.crates.io", "static.crates.io", "github.com"],
    },
  });
  const install = await sandbox.runCommand("curl", [
    "--proto", "=https", "--tlsv1.2", "--fail", "--silent", "--show-error",
    "https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init",
    "--output", "/tmp/rustup-init",
  ]);
  if (install.exitCode !== 0) throw new Error((await install.stderr()).trim() || "Rust installer download failed");
  const checksum = await sandbox.runCommand("sha256sum", ["/tmp/rustup-init"]);
  if (checksum.exitCode !== 0 || !(await checksum.stdout()).startsWith(rustupSha256)) {
    throw new Error("Rust installer checksum mismatch");
  }
  await sandbox.runCommand("chmod", ["0755", "/tmp/rustup-init"]);
  const rustup = await sandbox.runCommand("/tmp/rustup-init", [
    "-y", "--no-modify-path", "--profile", "minimal", "--default-toolchain", "1.94.0",
  ]);
  if (rustup.exitCode !== 0) throw new Error((await rustup.stderr()).trim() || "Rust installation failed");
  const build = await sandbox.runCommand({
    cmd: "/home/vercel-sandbox/.cargo/bin/cargo",
    args: ["build", "--locked", "--release", "--package", "faultscope-cli"],
    cwd: "/vercel/sandbox",
    timeoutMs: 30 * 60 * 1_000,
  });
  if (build.exitCode !== 0) throw new Error((await build.stderr()).trim() || "CLI build failed");
  const installed = await sandbox.runCommand({
    cmd: "install",
    args: ["-m", "0755", "/vercel/sandbox/target/release/faultscope", "/usr/local/bin/faultscope"],
    sudo: true,
  });
  if (installed.exitCode !== 0) throw new Error((await installed.stderr()).trim() || "CLI installation failed");
  await sandbox.update({ networkPolicy: "deny-all" });
  const snapshot = await sandbox.snapshot({ expiration: 0 });
  console.log(snapshot.snapshotId);
} catch (error) {
  await sandbox.stop().catch(() => {});
  throw error;
}
