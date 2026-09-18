// The Blacksmith: an NPC who sets up an anvil beside the Core once wave 7 is cleared.
// Talk to him (E) to forge tier III guns and armor, infuse guns with an element, fit attachments, and
// upgrade turrets (damage, range, fire rate, ammo, incendiary / frost rounds, armor plating).
import { ATTACH } from '../../shared/items.js';
import { SMITH, TURRET_TYPES } from '../../shared/holdout.js';
import { ELEMENTS } from '../../shared/elements.js';
import { ARMOR_SLOTS } from '../../shared/items.js';
import { giveItem } from './inventory.js';
import { nextUid } from '../baseRoom.js';
import { FORCED_EL } from './defenses.js';

export { SMITH };

export class Blacksmith {
  constructor(room) { this.room = room; }

  near(p) {
    const room = this.room;
    return room.bosses.smith && p.alive && !p.downed && Math.hypot(p.st.p[0] - SMITH.x, p.st.p[2] - SMITH.z) <= SMITH.reach + 0.8;
  }

  item(p, uid) { return p.inv.find(it => it?.uid === uid) ?? ARMOR_SLOTS.map(s => p.armor[s]).find(it => it?.uid === uid) ?? null; }

  pay(p, money, metal = 0) {
    if (p.money < money || (p.mats.metal || 0) < metal) { this.room.send(p, { t: 'deny', text: `Needs $${money}${metal ? ` + ${metal} metal` : ''}` }); return false; }
    p.money -= money;
    p.mats.metal -= metal;
    return true;
  }

  // m: { t: 'smith', op: 'forge' | 'infuse' | 'fit' | 'turret', uid?, el?, id?, def?, up? }
  handle(p, m) {
    const room = this.room, deny = text => room.send(p, { t: 'deny', text });
    if (!room.bosses.smith) return deny('The Blacksmith arrives once wave 7 is cleared');
    if (!this.near(p)) return deny('Talk to the Blacksmith at his anvil');
    if (m.op === 'forge') return room.inventory.onTierUp(p, { uid: m.uid }, true);
    if (m.op === 'infuse') {
      const it = this.item(p, m.uid);
      if (!it || it.kind !== 'gun' || !ELEMENTS[m.el]) return;
      const els = it.els ?? (it.el ? [it.el] : []);
      if (els.includes(m.el)) return deny('Already infused with that');
      if (!this.pay(p, SMITH.infuse.money, SMITH.infuse.metal * (1 + els.length))) return; // adds on: metal scales with what's already on it
      const next = [...els, m.el];
      it.el = next[0];
      it.els = next;
      room.send(p, { t: 'msg', text: `${ELEMENTS[m.el].name} infused` });
    } else if (m.op === 'fit') {
      const it = this.item(p, m.uid), a = ATTACH[m.id];
      if (!it || it.kind !== 'gun' || !a) return;
      if (it.att?.[a.slot] === m.id) return deny('Already fitted');
      if (!this.pay(p, a.price)) return;
      const old = it.att?.[a.slot];
      it.att = { ...it.att, [a.slot]: m.id };
      if (old) { const left = giveItem(p, { uid: nextUid(), id: old, kind: 'attach', n: 1 }); if (left) room.inventory.dropNear(p, left); }
      room.send(p, { t: 'msg', text: `${a.name} fitted` });
    } else if (m.op === 'turret') {
      const d = room.defenses.list.get(m.def | 0), u = SMITH.turret[m.up];
      if (!d || !TURRET_TYPES.includes(d.type) || !u) return;
      if ((m.up === 'inc' || m.up === 'frost') && FORCED_EL[d.type]) return deny('This turret already has its own element');
      d.mods ??= {};
      if (m.up === 'ammo') {
        if (!this.pay(p, u.price)) return;
        d.ammo = room.defenses.maxAmmo(d);
      } else {
        const level = d.mods[m.up] || 0;
        if (!this.pay(p, Math.round(u.price * 1.5 ** level))) return; // stacks without limit, pricier each level
        d.mods[m.up] = level + 1;
        if (m.up === 'plate') { d.hp += 300; d.maxHp = (d.maxHp || d.hp - 300) + 300; }
      }
      room.defenses.broadcastMods(d);
    } else return;
    room.sendInv(p);
    if (this.item(p, m.uid)?.kind === 'armor') room.armorChanged(p);
  }
}
