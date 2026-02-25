import { ToolbarItemDef, TOOLBAR_ITEM_DEFS } from './types';

export interface ToolbarSlot {
  item:  ToolbarItemDef | null;
  count: number;
}

/** 8-slot hotbar navigated by scroll wheel and keys 1–8. */
export class Toolbar {
  private readonly slots: ToolbarSlot[] = Array.from({ length: 8 }, () => ({ item: null, count: 0 }));
  private _selected = 0;

  get selected(): number { return this._selected; }
  get selectedSlot(): ToolbarSlot { return this.slots[this._selected]; }
  get selectedItem(): ToolbarItemDef | null { return this.slots[this._selected].item; }

  /** Navigate by scroll delta (+1 = next, −1 = prev). */
  scroll(delta: number): void {
    this._selected = ((this._selected + delta) % 8 + 8) % 8;
  }

  /** Directly select a slot (0-indexed). */
  selectSlot(index: number): void {
    if (index >= 0 && index < 8) this._selected = index;
  }

  /** Place an item (or add copies) into the first available slot, returns slot index. */
  addItem(def: ToolbarItemDef, count = 1): number {
    // Check if already in a slot
    const existing = this.slots.findIndex(s => s.item?.id === def.id);
    if (existing !== -1) {
      this.slots[existing].count += count;
      return existing;
    }
    // First empty slot
    const empty = this.slots.findIndex(s => s.item === null);
    if (empty !== -1) {
      this.slots[empty] = { item: def, count };
      return empty;
    }
    return -1; // toolbar full
  }

  getSlots(): readonly ToolbarSlot[] { return this.slots; }

  /** Clear all slots and reset selection to slot 1. */
  reset(): void {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i] = { item: null, count: 0 };
    }
    this._selected = 0;
  }

  /** Render the toolbar into the DOM toolbar element. */
  renderDOM(): void {
    const container = document.getElementById('toolbar');
    if (!container) return;
    container.innerHTML = '';

    this.slots.forEach((slot, i) => {
      const el = document.createElement('div');
      el.className = 'toolbar-slot' + (i === this._selected ? ' selected' : '');

      const keySpan = document.createElement('span');
      keySpan.className   = 'slot-key';
      keySpan.textContent = String(i + 1);
      el.appendChild(keySpan);

      if (slot.item) {
        el.style.borderColor = slot.item.color;

        const icon = document.createElement('span');
        icon.className   = 'slot-icon';
        icon.textContent = slot.item.icon;
        el.appendChild(icon);

        const name = document.createElement('span');
        name.className   = 'slot-name';
        name.textContent = slot.item.name;
        el.appendChild(name);

        if (slot.count > 1) {
          const cnt = document.createElement('span');
          cnt.className   = 'slot-count';
          cnt.textContent = String(slot.count);
          el.appendChild(cnt);
        }
      }

      container.appendChild(el);
    });
  }
}
