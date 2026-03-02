import html2canvas from 'html2canvas';
import { RefObject, useState } from 'react';

export type ShareState = 'idle' | 'capturing' | 'sharing' | 'downloaded' | 'error';

export function useShareResults(cardRef: RefObject<HTMLDivElement>) {
  const [state, setState] = useState<ShareState>('idle');

  const share = async () => {
    if (!cardRef.current || state === 'capturing' || state === 'sharing') return;

    setState('capturing');

    try {
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,           // 2× for retina — final image is 2400×1260px
        useCORS: true,
        logging: false,
        backgroundColor: '#1c1c1c',
      });

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });

      if (!blob) throw new Error('Failed to create image');

      const file = new File([blob], 'amari-method-pain-pattern.png', { type: 'image/png' });

      // Mobile: use native Web Share API (shows iOS/Android share sheet)
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        setState('sharing');
        await navigator.share({
          title: 'My Amari Method Pain Pattern',
          text: 'I took the Amari Method pain pattern assessment. See what yours says.',
          files: [file],
        });
        setState('idle');
      } else {
        // Desktop: download the image
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'amari-method-pain-pattern.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setState('downloaded');
        setTimeout(() => setState('idle'), 3000);
      }
    } catch (err) {
      // User cancelled native share — not an error
      if (err instanceof Error && err.name === 'AbortError') {
        setState('idle');
      } else {
        setState('error');
        setTimeout(() => setState('idle'), 3000);
      }
    }
  };

  return { share, state };
}
