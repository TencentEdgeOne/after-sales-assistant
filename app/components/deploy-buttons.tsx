'use client';

import { useEffect, useState } from 'react';

interface DeployButtonsProps {
  /** EdgeOne Makers template slug (see the deploy link in README). */
  templateSlug: string;
  /** GitHub repository URL. */
  githubUrl: string;
  /** UI language for the deploy button label. */
  lang?: 'zh' | 'en';
}

const QUERY_SUFFIX = '&from=within&fromAgent=1&agentLang=typescript';

/**
 * Header actions: one-click "Deploy to EdgeOne Makers" + a link to the GitHub
 * repository. The deploy target depends on the host the page is served from —
 * the international edgeone.ai console for *.edgeone.dev, otherwise the Tencent
 * Cloud console. We default to the Tencent URL so the link is valid during SSR
 * / first paint, then refine on the client once `window` is available.
 *
 * Styling is theme-agnostic on purpose: the GitHub button inherits the header's
 * text color (currentColor) so it blends into any template/theme, and the
 * deploy button uses a fixed brand blue that reads well on light and dark
 * headers alike — no dependency on each template's dark-mode strategy.
 */
export function DeployButtons({ templateSlug, githubUrl, lang = 'en' }: DeployButtonsProps) {
  const tencentUrl = `https://console.cloud.tencent.com/edgeone/makers/new?template=${templateSlug}${QUERY_SUFFIX}`;
  const edgeoneAiUrl = `https://edgeone.ai/makers/new?template=${templateSlug}${QUERY_SUFFIX}`;
  const [deployUrl, setDeployUrl] = useState(tencentUrl);

  useEffect(() => {
    try {
      const domain = new URL(window.location.href).hostname.split('.').slice(1).join('.');
      setDeployUrl(domain === 'edgeone.dev' ? edgeoneAiUrl : tencentUrl);
    } catch {
      // keep default
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateSlug]);

  return (
    <div className="flex items-center gap-2">
      <a
        href={githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="GitHub"
        aria-label="GitHub repository"
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-500/30 opacity-70 hover:opacity-100 transition-opacity"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 .5C5.73.5.5 5.74.5 12.02c0 5.1 3.29 9.42 7.86 10.96.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.73 1.27 3.4.97.1-.75.41-1.27.74-1.56-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.41-5.27 5.69.42.36.8 1.08.8 2.18v3.23c0 .31.21.67.8.56A11.53 11.53 0 0 0 23.5 12.02C23.5 5.74 18.27.5 12 .5z" />
        </svg>
      </a>
      <a
        href={deployUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        {lang === 'zh' ? '一键部署' : 'Deploy'}
      </a>
    </div>
  );
}
