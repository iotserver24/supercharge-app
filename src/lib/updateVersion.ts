type Version = { core: bigint[]; pre: string[] };

function parse(value: string): Version | null {
  const text = value.trim().replace(/^(?:supercharge(?:\s+cli)?\s+)?v?/i, "").split(/\s/)[0] ?? "";
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (!match) return null;
  const pre = match[4]?.split(".") ?? [];
  if (pre.some((part) => !part || (/^\d+$/.test(part) && part.length > 1 && part.startsWith("0")))) return null;
  return { core: match.slice(1, 4).map(BigInt), pre };
}

export function isNewerVersion(current: string | null | undefined, candidate: string | null | undefined): boolean {
  const a = parse(current ?? "");
  const b = parse(candidate ?? "");
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return b.core[i]! > a.core[i]!;
  }
  if (!a.pre.length || !b.pre.length) return !!a.pre.length && !b.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const av = a.pre[i];
    const bv = b.pre[i];
    if (av === bv) continue;
    if (av === undefined) return true;
    if (bv === undefined) return false;
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) return BigInt(bv) > BigInt(av);
    if (an !== bn) return an;
    return bv > av;
  }
  return false;
}

export function isVersionAtLeast(value: string, minimum: string): boolean {
  return !!parse(value) && !!parse(minimum) && !isNewerVersion(value, minimum);
}

export function shouldDownloadUpdate(installed: string, downloaded: string | null, candidate: string): boolean {
  return isNewerVersion(installed, candidate) && (!downloaded || isNewerVersion(downloaded, candidate));
}
