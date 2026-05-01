import { ui, defaultLocale, type Locale } from './ui';

export function getLangFromUrl(url: URL): Locale {
	const pathname = url.pathname.replace(/^\/Sea_of_Bits\/?/, '/');
	const [, lang] = pathname.split('/');
	if (lang === 'en') return 'en';
	return defaultLocale;
}

export function useTranslations(lang: Locale) {
	return function t(key: keyof (typeof ui)[typeof defaultLocale]): string {
		return ui[lang][key] || ui[defaultLocale][key];
	};
}

export function localePath(path: string, lang: Locale): string {
	if (lang === defaultLocale) return `/Sea_of_Bits${path}`;
	return `/Sea_of_Bits/${lang}${path}`;
}

export function parsePostId(id: string): { slug: string; lang: Locale } {
	if (id.startsWith('en/')) return { slug: id.slice(3), lang: 'en' };
	if (id.startsWith('zh/')) return { slug: id.slice(3), lang: 'zh' };
	return { slug: id, lang: defaultLocale };
}

export function getDateLocale(lang: Locale): string {
	return lang === 'zh' ? 'zh-CN' : 'en-US';
}
