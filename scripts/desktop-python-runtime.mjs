export function shouldBundlePythonRuntimeItem(path) {
  const normalizedPath = path.replaceAll("\\", "/");
  if (normalizedPath.includes("/__pycache__/") || normalizedPath.endsWith(".pyc")) return false;
  const name = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
  return !/^__editable__.*\.pth$|^_editable_impl_.*\.pth$/iu.test(name);
}
