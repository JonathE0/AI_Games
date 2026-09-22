// The Blacksmith: an NPC who sets up an anvil beside the Core once wave 7 is cleared.
// Talk to him (E) to forge tier III guns and armor, infuse guns with an element, fit attachments, buy the wave
// milestones (tier IV / V, gun mods, the Toxic element, a second mod slot), grow the Ronin's katana (its own tree,
// SMITH.katana) and upgrade turrets (damage, range, fire rate, ammo capacity, plating, incendiary / frost rounds).
// Turrets can also be upgraded standing by them.
import { ATTACH, milestoneBlock, itemName } from '../../shared/items.js';
import { SMITH, TURRET_TYPES, TURRET_EL, DEFENSES, turretMul, turretUpPrice } from '../../shared/holdout.js';
import { ELEMENTS, ELEMENT_IDS } from '../../shared/elements.js';
import { ARMOR_SLOTS } from '../../shared/items.js';
import { giveItem } from './inventory.js';
import { nextUid } from '../baseRoom.js';

export { SMITH };
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : null); // client keys: never 'constructor' & co.

export class Blacksmith {
  constructor(room) { this.room = room; }

  near(p) {
    const room = this.room;
    return room.bosses.smith && p.alive && !p.downed && Math.hypot(p.st.p[0] - SMITH.x, p.st.p[2] - SMITH.z) <= SMITH.reach + 0.8;
  }

  // standing by a turret (the "Upgrade turret" key opens its panel from here)
  byTurret(p, d) {
    return p.alive && !p.downed && Math.hypot(p.st.p[0] - d.pos[0], p.st.p[2] - d.pos[2]) <= SMITH.turretReach + 0.8 && Math.abs(p.st.p[1] - d.pos[1]) < 3;
  }

  item(p, uid) { return p.inv.find(it => it?.uid === uid) ?? ARMOR_SLOTS.map(s => p.armor[s]).find(it => it?.uid === uid) ?? null; }

  pay(p, money, zink = 0) {
    if (p.money < money || (p.mats.zink || 0) < zink) { this.room.send(p, { t: 'deny', text: `Needs $${money}${zink ? ` + ${zink} Zinkonium` : ''}` }); return false; }
    p.money -= money;
    p.mats.zink -= zink;
    return true;
  }

  // m: { t: 'smith', op: 'forge' | 'infuse' | 'fit' | 'mile' | 'turret', uid?, el?, id?, def?, up? }
  handle(p, m) {
    const room = this.room, deny = text => room.send(p, { t: 'deny', text });
    if (m.op === 'turret') return this.turret(p, m);
    if (!room.bosses.smith) return deny('The Blacksmith arrives once wave 7 is cleared');
    if (!this.near(p)) return deny('Talk to the Blacksmith at his anvil');
    if (m.op !== 'mile' && this.item(p, m.uid)?.id === 'katana') return deny('The katana grows through its own tree (the Katana section)');
    if (m.op === 'forge') return room.inventory.onTierUp(p, { uid: m.uid }, true);
    if (m.op === 'infuse') {
      const it = this.item(p, m.uid);
      if (!it || it.kind !== 'gun' || !ELEMENT_IDS.includes(m.el)) return; // Toxic is a milestone, not an infusion
      const els = it.els ?? (it.el ? [it.el] : []);
      if (els.includes(m.el)) return deny('Already infused with that');
      if (!this.pay(p, SMITH.infuse.money, SMITH.infuse.zink * (1 + els.length))) return; // adds on: Zinkonium cost scales with what's already on it
      const next = [...els, m.el];
      it.el = next[0];
      it.els = next;
      room.send(p, { t: 'msg', text: `${ELEMENTS[m.el].name} infused` });
    } else if (m.op === 'fit') {
      const it = this.item(p, m.uid), a = own(ATTACH, m.id);
      if (!it || it.kind !== 'gun' || !a) return;
      if (it.att?.[a.slot] === m.id) return deny('Already fitted');
      if (!this.pay(p, a.price)) return;
      const old = it.att?.[a.slot];
      it.att = { ...it.att, [a.slot]: m.id };
      if (old) { const left = giveItem(p, { uid: nextUid(), id: old, kind: 'attach', n: 1 }); if (left) room.inventory.dropNear(p, left); }
      room.send(p, { t: 'msg', text: `${a.name} fitted` });
    } else if (m.op === 'mile') { // wave milestones (the katana: its own tree): mastery + money + Zinkonium (milestoneBlock says why not)
      const it = this.item(p, m.uid), kat = it?.id === 'katana', u = own(kat ? SMITH.katana : SMITH.ups, m.id);
      if (!u) return;
      const why = milestoneBlock(m.id, it, room.wave, p.money, p.mats.zink || 0, m.el);
      if (why) return deny(why);
      p.money -= u.money;
      p.mats.zink -= u.zink;
      if (kat) { const ku = it.ku ??= {}; if (u.edge) ku.edge = u.edge; else if (m.id === 'elem') it.el = m.el; else ku[m.id] = 1; } // (it stays on the player: ronin.js)
      else if (m.id === 'tier4' || m.id === 'tier5') it.tier = m.id === 'tier4' ? 4 : 5;
      else if (m.id === 'toxic') { it.els = [...(it.els ?? (it.el ? [it.el] : [])), 'toxic']; it.el = it.els[0]; }
      else if (m.id === 'slot2') it.modSlots = 2;
      else it.mods = [...(it.mods ?? []), m.id].slice(-(it.modSlots ?? 1)); // slots full: the new mod replaces the oldest
      room.send(p, { t: 'msg', text: `${u.name}: ${itemName(it)}` });
    } else return;
    room.sendInv(p);
    if (this.item(p, m.uid)?.kind === 'armor') room.armorChanged(p);
  }

  // Turret upgrades (SMITH.turret), m: { def, up } — at the anvil or standing by the turret (no Blacksmith needed then).
  turret(p, m) {
    const room = this.room, deny = text => room.send(p, { t: 'deny', text });
    const d = room.defenses.list.get(m.def | 0), u = own(SMITH.turret, m.up);
    if (!d || !TURRET_TYPES.includes(d.type) || !u) return;
    if (!this.near(p) && !this.byTurret(p, d)) return deny(`Stand within ${SMITH.turretReach} m of the turret to upgrade it`);
    const md = d.mods ??= {}, base = DEFENSES[d.type];
    if (m.up === 'inc' || m.up === 'frost') {
      if (TURRET_EL[d.type]) return deny('This turret already has its own element');
      if (md[m.up]) return deny('Already fitted');
      if (!this.pay(p, u.price)) return;
      delete md[m.up === 'inc' ? 'frost' : 'inc']; // one kind of rounds at a time
      md[m.up] = 1;
    } else if (m.up === 'ammo') {
      if (!this.pay(p, u.price)) return;
      d.ammo = room.defenses.maxAmmo(d);
    } else {
      if (!this.pay(p, turretUpPrice(m.up, md))) return; // stacks without limit, pricier each level
      md[m.up] = (md[m.up] || 0) + 1;
      if (m.up === 'cap') d.ammo += base.ammo * u.per; // the new capacity comes loaded
      if (m.up === 'plate') { d.hp += base.hp * u.per; d.maxHp = Math.round(base.hp * turretMul(md, 'plate')); }
    }
    room.defenses.broadcastMods(d);
    room.sendInv(p);
  }
}
