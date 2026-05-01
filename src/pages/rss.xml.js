import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';
import { parsePostId } from '../i18n/utils';

export async function GET(context) {
	const posts = (await getCollection('blog')).filter(
		(p) => parsePostId(p.id).lang === 'zh',
	);
	return rss({
		title: 'dahai9 博客',
		description: '欢迎来到我的网站！',
		site: context.site,
		items: posts.map((post) => ({
			...post.data,
			link: `/blog/${parsePostId(post.id).slug}/`,
		})),
	});
}
