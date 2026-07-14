export function inferObjectKeyFromPublicUrl(url: string): string | null {
  try {
    const pathname = new URL(url.trim()).pathname.replace(/^\/+/, '');
    if (pathname.startsWith('users/')) {
      return pathname;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractUserIdFromObjectKey(objectKey: string): string | null {
  const match = objectKey.match(/^users\/([^/]+)\//);
  return match?.[1] ?? null;
}
