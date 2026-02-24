import {
  Material, MATERIAL_PROPS, CRAFTING_RECIPES, CraftingRecipe,
  TOOLBAR_ITEM_DEFS, ToolbarItemDef, InventoryItem,
} from './types';
import { Player }  from './player';
import { Toolbar } from './toolbar';

/** Manages the crafting panel DOM and crafting logic. */
export class CraftingSystem {
  private visible = false;

  constructor(
    private readonly player:  Player,
    private readonly toolbar: Toolbar,
    private readonly notify:  (msg: string) => void,
  ) {
    document.getElementById('close-crafting')?.addEventListener('click', () => this.hide());
  }

  toggle(): void { this.visible ? this.hide() : this.show(); }
  show():   void { this.visible = true;  this._render(); document.getElementById('crafting-panel')?.classList.remove('hidden'); }
  hide():   void { this.visible = false; document.getElementById('crafting-panel')?.classList.add('hidden'); }
  isOpen(): boolean { return this.visible; }

  /** Re-render the crafting panel (call when inventory changes). */
  refresh(): void { if (this.visible) this._render(); }

  private _render(): void {
    this._renderInventory();
    this._renderRecipes();
  }

  private _renderInventory(): void {
    const el = document.getElementById('crafting-inventory');
    if (!el) return;
    el.innerHTML = '';

    for (const mat of Object.values(Material) as Material[]) {
      const qty = this.player.getResource(mat);
      if (qty === 0) continue;

      const chip = document.createElement('div');
      chip.className = 'inv-chip';

      const props = MATERIAL_PROPS[mat];
      if (props.sprite) {
        const img = document.createElement('img');
        img.src       = props.sprite;
        img.alt       = mat;
        img.className = 'chip-icon';
        chip.appendChild(img);
      } else {
        const dot = document.createElement('span');
        dot.className           = 'chip-dot';
        dot.style.background    = props.color;
        chip.appendChild(dot);
      }

      chip.appendChild(document.createTextNode(`${mat}: ${qty}`));
      el.appendChild(chip);
    }

    if (el.children.length === 0) {
      el.textContent = 'No resources yet – mine some asteroids!';
      el.style.color = 'rgba(255,255,255,0.4)';
      el.style.fontSize = '12px';
    } else {
      el.style.color    = '';
      el.style.fontSize = '';
    }
  }

  private _renderRecipes(): void {
    const el = document.getElementById('crafting-recipes');
    if (!el) return;
    el.innerHTML = '';

    for (const recipe of CRAFTING_RECIPES) {
      const canCraft = this._canCraft(recipe);
      const card     = document.createElement('div');
      card.className = 'recipe-card' + (canCraft ? ' can-craft' : '');

      const info = document.createElement('div');
      info.className = 'recipe-info';

      const nameLine = document.createElement('div');
      nameLine.className   = 'recipe-name';
      nameLine.textContent = `${recipe.icon ?? ''} ${recipe.name}`;
      info.appendChild(nameLine);

      const descLine = document.createElement('div');
      descLine.className   = 'recipe-desc';
      descLine.textContent = recipe.description;
      info.appendChild(descLine);

      const inputLine = document.createElement('div');
      inputLine.className   = 'recipe-inputs';
      inputLine.textContent = 'Requires: ' + recipe.inputs.map(
        i => `${i.material} ×${i.quantity} (have ${this.player.getResource(i.material)})`
      ).join(', ');
      info.appendChild(inputLine);

      card.appendChild(info);

      const btn = document.createElement('button');
      btn.className   = 'craft-btn';
      btn.textContent = 'Craft';
      btn.disabled    = !canCraft;
      btn.addEventListener('click', () => this._craft(recipe));
      card.appendChild(btn);

      el.appendChild(card);
    }
  }

  private _canCraft(recipe: CraftingRecipe): boolean {
    return recipe.inputs.every(i => this.player.getResource(i.material) >= i.quantity);
  }

  private _craft(recipe: CraftingRecipe): void {
    if (!this._canCraft(recipe)) return;

    // Deduct resources
    for (const input of recipe.inputs) {
      this.player.addResource(input.material, -input.quantity);
    }

    const def = TOOLBAR_ITEM_DEFS[recipe.outputId];
    if (!def) return;

    const slotIdx = this.toolbar.addItem(def, recipe.outputQty);
    this.toolbar.renderDOM();

    // Equip in player so passive effects apply
    if (slotIdx !== -1) this.player.equipItem(slotIdx, def);

    // Also add a ship module to the palette for placement in the ship editor
    if (recipe.moduleType) {
      this.player.addModuleToPalette(recipe.id, recipe.moduleType);
    }

    this.notify(`Crafted: ${recipe.name}`);
    this._render();
  }
}
