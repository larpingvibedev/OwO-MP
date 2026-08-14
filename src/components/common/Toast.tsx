import { useEffect } from 'react';
import { usePlayerStore } from '../../store/usePlayerStore';
import { Check } from 'lucide-react';

export function Toast() {
  const { toastMessage, hideToast } = usePlayerStore();

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        hideToast();
      }, 2400);
      return () => clearTimeout(timer);
    }
  }, [toastMessage, hideToast]);

  if (!toastMessage) return null;

  return (
    <div className="global-toast-container visible">
      <div style={{
        width: '24px',
        height: '24px',
        borderRadius: '50%',
        backgroundColor: 'var(--accent-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#000',
        flexShrink: 0
      }}>
        <Check size={14} strokeWidth={3} />
      </div>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '340px' }}>
        {toastMessage}
      </span>
    </div>
  );
}
