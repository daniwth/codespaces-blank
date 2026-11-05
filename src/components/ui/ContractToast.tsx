import { ClipboardCheck } from 'lucide-react';
import { useEffect } from 'react';
import { useGameStore } from '../../store/useGameStore';

/** HUD banner: a contract was just completed (click to open the board). */
export function ContractToast() {
  const toast = useGameStore((s) => s.contractToast);
  const dismiss = useGameStore((s) => s.dismissContractToast);
  const setSideTab = useGameStore((s) => s.setSideTab);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(dismiss, 4500);
    return () => clearTimeout(t);
  }, [toast, dismiss]);
  if (!toast) return null;
  return (
    <div className="fixed bottom-4 right-3 z-40 max-w-[min(92vw,360px)]" key={toast.t} role="status" aria-live="polite">
      <button
        type="button"
        onClick={() => {
          setSideTab('contracts');
          dismiss();
        }}
        className="pop-in flex w-full items-center gap-3 bg-[#0b0a18] px-3 py-2 text-left"
        style={{ boxShadow: '0 0 0 3px #fb923c, 0 0 20px #fb923c88' }}
      >
        <span className="grid size-9 shrink-0 place-items-center bg-[#fb923c22] text-[#fb923c] shadow-[inset_0_0_0_2px_#fb923c88]">
          <ClipboardCheck size={18} />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block font-silk text-[10px] text-dim">CONTRACT COMPLETE</span>
          <span className="block font-pixel text-[10px] text-[#fb923c]">{toast.title.toUpperCase()}</span>
          <span className="block truncate text-[16px] text-ink">{toast.goal}</span>
          <span className="block text-[15px] text-lime">Click to claim your reward</span>
        </span>
      </button>
    </div>
  );
}
