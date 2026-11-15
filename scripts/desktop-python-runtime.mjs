export function shouldBundlePythonRuntimeItem(path) {
  const normalizedPath = path.replaceAll("\\", "/");
  if (normalizedPath.includes("/__pycache__/") || normalizedPath.endsWith(".pyc")) return false;
  const name = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
  // The macOS Python distribution includes an Intel-only helper executable and
  // static development archives. They are not used by the embedded runtime,
  // and the archives retain absolute build-machine framework references that
  // cannot be relocated with install_name_tool.
  if (/^python3(?:\.12)?-intel64$/iu.test(name)) return false;
  if (/\/config-[^/]+\/libpython[^/]*\.a$/iu.test(normalizedPath)) return false;
  return !/^__editable__.*\.pth$|^_editable_impl_.*\.pth$/iu.test(name);
}
