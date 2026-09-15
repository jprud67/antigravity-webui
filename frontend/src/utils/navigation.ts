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
