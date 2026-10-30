// ============================================================================
// 插件 settings.json 里 packages 数组的纯编辑函数（ticket 0024）
// ============================================================================
//
// 为什么需要这一层：pi SDK 的 `DefaultPackageManager.removeAndPersist` 用
// **cwd** 去解析相对路径来决定删哪一条 settings 条目，而它自己写入 settings
// 时用的是相对 **agentDir**（或项目目录）的路径。两者层级不同，同一个相对
// 路径就会解析成两个绝对路径，匹配不上 → 删除静默无效（ticket 0023 手测
// 撞到：装 `C:/Users/YLYC/ego/x` 存成 `..\..\ego\x`，再删同一条返回 changed
// false，包留在列表里）。
//
// 这里按「settings 里的原文」精确匹配删除，和 UI 上看到的那条字符串一致，
// 不参与任何路径解析。
import type { PackageSource } from "@earendil-works/pi-coding-agent";

/** settings 条目可能是字符串，也可能是带筛选/autoload 的对象。 */
export function getPackageSourceString(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

/**
 * 从 packages 数组里移除 source 完全相同的条目。
 *
 * 返回新数组；没有匹配时返回 `null`（调用方据此跳过写入，避免无意义的
 * settings 落盘）。同一 source 出现多次只会全部移除，因为它们指向同一条
 * 配置。
 */
export function removePackageSource(
  packages: readonly PackageSource[],
  source: string,
): PackageSource[] | null {
  const next = packages.filter((entry) => getPackageSourceString(entry) !== source);
  return next.length === packages.length ? null : next;
}

/** packages 里是否已经配置了这个 source（按原文比较，不看 scope）。 */
export function hasPackageSource(packages: readonly PackageSource[], source: string): boolean {
  return packages.some((entry) => getPackageSourceString(entry) === source);
}
