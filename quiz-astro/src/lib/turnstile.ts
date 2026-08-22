type TurnstileWidget = {
  render: (element: HTMLElement, options: {
    sitekey: string;
    size: 'invisible';
    action: string;
    callback: (token: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
  }) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileWidget;
    amariTurnstileToken?: string;
    amariTurnstileWidget?: string;
  }
}

export function mountTurnstile(element: HTMLElement, siteKey: string) {
  if (!siteKey) return;
  const render = () => {
    if (!window.turnstile || window.amariTurnstileWidget) return false;
    window.amariTurnstileWidget = window.turnstile.render(element, {
      sitekey: siteKey,
      size: 'invisible',
      action: 'quiz-submission',
      callback: (token) => { window.amariTurnstileToken = token; },
      'expired-callback': () => { window.amariTurnstileToken = undefined; },
      'error-callback': () => { window.amariTurnstileToken = undefined; },
    });
    return true;
  };
  if (render()) return;
  const timer = window.setInterval(() => {
    if (render()) window.clearInterval(timer);
  }, 100);
  window.setTimeout(() => window.clearInterval(timer), 10000);
}

export function getTurnstileToken(): Promise<string> {
  if (window.amariTurnstileToken) {
    const token = window.amariTurnstileToken;
    window.amariTurnstileToken = undefined;
    return Promise.resolve(token);
  }
  const turnstile = window.turnstile;
  const widget = window.amariTurnstileWidget;
  if (!turnstile || !widget) return Promise.reject(new Error('Bot verification is unavailable.'));

  return new Promise((resolve, reject) => {
    turnstile.reset(widget);
    turnstile.execute(widget);
    const timer = window.setInterval(() => {
      if (window.amariTurnstileToken) {
        const token = window.amariTurnstileToken;
        window.amariTurnstileToken = undefined;
        window.clearInterval(timer);
        resolve(token);
      }
    }, 100);
    window.setTimeout(() => {
      window.clearInterval(timer);
      reject(new Error('Bot verification timed out.'));
    }, 10000);
  });
}
