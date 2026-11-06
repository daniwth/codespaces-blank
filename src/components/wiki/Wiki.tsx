import { PixelModal } from '../ui/PixelModal';

/**
 * Temporary placeholder: the full "How to play" wiki lands in a separate
 * change and replaces this file. PixelModal already registers in modalStack.
 */
export default function Wiki({ onClose }: { onClose: () => void }) {
  return (
    <PixelModal title="How to play" onClose={onClose} className="max-w-lg" accent="#a3e635">
      <p className="text-[18px] leading-tight text-ink/90">
        Buy GPUs in the Shop, install them in racks with a PSU and fans, and keep the dies cool while they mine $CC. Sell $CC on the Market to pay the
        power bill and expand into bigger rooms, then trigger The Halving to earn $SC for permanent talents.
      </p>
    </PixelModal>
  );
}
