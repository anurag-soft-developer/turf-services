export class EventSlugUtility {
  static slugifyTitle(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  static withSuffix(base: string, suffix: string): string {
    return `${base}-${suffix}`;
  }
}
