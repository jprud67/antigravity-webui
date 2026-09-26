export const getConvIdFromPath = (pathname: string): string | null => {
  const match = pathname.match(/^\/(?:c|chat)\/([a-zA-Z0-9_-]+)/);
  if (match && match[1] && match[1] !== 'new') {
    return match[1];
  }
  return null;
};

export const navigateToConversation = (convId: string | null, replace = false): void => {
  const targetPath = convId ? `/c/${convId}` : '/';
  if (window.location.pathname !== targetPath) {
    if (replace) {
      window.history.replaceState({ convId }, '', targetPath);
    } else {
      window.history.pushState({ convId }, '', targetPath);
    }
  }
};

export const getShareTokenFromUrl = (): string | null => {
  if (typeof window === 'undefined') return null;
  // 1. Path format: /share/:token or /s/:token
  const pathMatch = window.location.pathname.match(/^\/(?:share|s)\/([a-zA-Z0-9_-]+)/);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1];
  }
  // 2. Query param: ?share=:token or ?share_token=:token
  const params = new URLSearchParams(window.location.search);
  const qToken = params.get('share') || params.get('share_token');
  if (qToken && qToken.trim()) {
    return qToken.trim();
  }
  return null;
};

