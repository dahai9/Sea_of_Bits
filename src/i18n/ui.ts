export const languages = {
	zh: '中文',
	en: 'English',
} as const;

export type Locale = keyof typeof languages;

export const defaultLocale: Locale = 'zh';

export const ui = {
	zh: {
		'site.title': 'dahai9 博客',
		'site.description': '欢迎来到我的网站！',
		'nav.home': '首页',
		'nav.blog': '博客',
		'nav.about': '关于',
		'hero.heading': '分享想法。\n探讨技术。',
		'hero.subheading': '欢迎来到我的技术深潜、创意思考空间。',
		'home.recentWriting': '最近文章',
		'home.viewAll': '查看所有文章 →',
		'blog.lastUpdated': '最后更新于',
		'footer.rights': '版权所有',
	},
	en: {
		'site.title': 'dahai9 Blog',
		'site.description': 'Welcome to my website!',
		'nav.home': 'Home',
		'nav.blog': 'Blog',
		'nav.about': 'About',
		'hero.heading': 'Share Ideas.\nDiscuss Tech.',
		'hero.subheading':
			'Welcome to my space for technical deep dives, creative thoughts, and everything in between.',
		'home.recentWriting': 'Recent Writing',
		'home.viewAll': 'View all posts →',
		'blog.lastUpdated': 'Last updated on',
		'footer.rights': 'All rights reserved',
	},
} as const;
