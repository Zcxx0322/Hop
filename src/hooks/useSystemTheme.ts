import { useEffect, useState } from 'react';

export type ResolvedTheme = 'dark' | 'light';

const readSystemTheme = (): ResolvedTheme => {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/** 跟随系统配色（settings.theme === 'system' 时使用）。 */
export function useSystemTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(readSystemTheme);

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return theme;
}
