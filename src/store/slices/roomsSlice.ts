import { tr } from '../../i18n';
import { MAX_TECHNICIANS, TECHNICIAN_BASE_COST, TECHNICIAN_COST_GROWTH } from '../../config/hardwareCatalog';
import { MAX_PADS, ROOM_BY_ID, ROOM_ORDER } from '../../config/roomsCatalog';
import { talentModifiers } from '../../config/prestigeTree';
import type { RoomId, TalentLevels } from '../../types/player';
import { bnGte, bnSub } from '../../utils/bignum';
import { fxBus, sfxBus } from '../../utils/eventBus';
import { formatCash } from '../../utils/formatters';
import type { GetState, RoomsSlice, SetState } from '../storeTypes';

export const padCount = (roomId: RoomId, talents: TalentLevels): number =>
  Math.min(MAX_PADS, ROOM_BY_ID[roomId].pads + talentModifiers(talents).extraPads);

export const technicianCost = (hired: number, startFree: number): number =>
  Math.round(TECHNICIAN_BASE_COST * TECHNICIAN_COST_GROWTH ** Math.max(0, hired - startFree));

export function createRoomsSlice(set: SetState, get: GetState): RoomsSlice {
  return {
    buyRoom: (roomId) => {
      const s = get();
      const room = ROOM_BY_ID[roomId];
      if (s.ownedRooms.includes(roomId)) return false;
      const idx = ROOM_ORDER.indexOf(roomId);
      const prev = ROOM_ORDER[idx - 1];
      if (prev && !s.ownedRooms.includes(prev)) {
        s.pushLog(tr('Unlock {name} first.', { name: tr(ROOM_BY_ID[prev].name) }), 'warn');
        sfxBus.emit('error');
        return false;
      }
      if (!bnGte(s.cash, room.price)) {
        s.pushLog(tr('{name} costs {price}.', { name: tr(room.name), price: formatCash(room.price) }), 'warn');
        sfxBus.emit('error');
        return false;
      }
      set({
        cash: bnSub(s.cash, room.price),
        ownedRooms: [...s.ownedRooms, roomId],
        activeRoom: roomId,
        roomTemps: { ...s.roomTemps, [roomId]: room.ambient },
      });
      s.pushLog(tr('New property: {name}! {subtitle}.', { name: tr(room.name), subtitle: tr(room.subtitle) }), 'good');
      sfxBus.emit('unlock');
      fxBus.emit({ kind: 'confetti', intensity: 0.8 });
      return true;
    },

    setActiveRoom: (roomId) => {
      if (!get().ownedRooms.includes(roomId)) return;
      set({ activeRoom: roomId });
      sfxBus.emit('switch');
    },

    placeRack: (rackUid, roomId, pad) => {
      const s = get();
      const rack = s.racks[rackUid];
      if (!rack || !s.ownedRooms.includes(roomId) || pad >= padCount(roomId, s.talents)) return false;
      const occupied = Object.values(s.racks).some((r) => r.uid !== rackUid && r.roomId === roomId && r.pad === pad);
      if (occupied) return false;
      set({ racks: { ...s.racks, [rackUid]: { ...rack, roomId, pad } } });
      sfxBus.emit('install');
      return true;
    },

    storeRack: (rackUid) => {
      set((s) => (s.racks[rackUid] ? { racks: { ...s.racks, [rackUid]: { ...s.racks[rackUid], roomId: null, pad: null } } } : {}));
      sfxBus.emit('switch');
    },

    hireTechnician: () => {
      const s = get();
      if (s.technicians >= MAX_TECHNICIANS) return false;
      const cost = technicianCost(s.technicians, talentModifiers(s.talents).startTechnicians);
      if (!bnGte(s.cash, cost)) {
        sfxBus.emit('error');
        s.pushLog(tr('Hiring a technician costs {price}.', { price: formatCash(cost) }), 'warn');
        return false;
      }
      set({ cash: bnSub(s.cash, cost), technicians: s.technicians + 1 });
      s.pushLog(tr('A new technician joined the crew. They will re-paste and repair rigs automatically.'), 'good');
      sfxBus.emit('unlock');
      return true;
    },
  };
}
