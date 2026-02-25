import { Vec2 } from './types';

/** Joystick finger tracking state. */
interface JoystickState {
  active:  boolean;
  touchId: number;
  dx:      number; // normalised [-1, 1]
  dy:      number; // normalised [-1, 1]
}

const JOYSTICK_RADIUS_PX   = 60;   // half the visual joystick diameter
const JOYSTICK_DEADZONE    = 0.15; // normalised magnitude below which input is ignored
const RIGHT_STICK_FIRE_THR = 0.4;  // normalised magnitude above which the right stick fires
const AIM_OFFSET_PX        = 800;  // pixels away from canvas centre used as virtual mouse pos

/** Tracks keyboard state, mouse canvas position, and scroll wheel. */
export class InputManager {
  private readonly keys = new Set<string>();
  private mouse: Vec2 = { x: 0, y: 0 };
  private _scrollDelta = 0;
  private _mouseDown = false;
  private _mouseRightDown = false;

  /** True when a touch device is detected. */
  readonly isMobile: boolean;

  /** Left joystick (movement). */
  private _leftStick:  JoystickState = { active: false, touchId: -1, dx: 0, dy: 0 };
  /** Right joystick (aim + fire). */
  private _rightStick: JoystickState = { active: false, touchId: -1, dx: 0, dy: 0 };

  /** Canvas-drag block-placement touch tracking. */
  private _mobilePlace       = false;
  private _mobilePlaceTouchId = -1;
  private _mobilePlacePos: Vec2 = { x: 0, y: 0 };

  private _canvasWidth  = 1;
  private _canvasHeight = 1;

  constructor(canvas: HTMLCanvasElement) {
    this._canvasWidth  = canvas.width  || window.innerWidth;
    this._canvasHeight = canvas.height || window.innerHeight;

    this.isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    window.addEventListener('keydown', e => {
      this.keys.add(e.key.toLowerCase());
      // Prevent Tab from cycling browser focus
      if (e.key === 'Tab') e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      // Scale for CSS size vs actual canvas resolution
      const scaleX = canvas.width  / r.width;
      const scaleY = canvas.height / r.height;
      this.mouse = { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY };
    });

    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) this._mouseDown = true;
      if (e.button === 2) { this._mouseRightDown = true; e.preventDefault(); }
    });
    canvas.addEventListener('mouseup', e => {
      if (e.button === 0) this._mouseDown = false;
      if (e.button === 2) this._mouseRightDown = false;
    });
    // Prevent the context menu from appearing on right-click
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this._scrollDelta += e.deltaY > 0 ? 1 : -1;
    }, { passive: false });

    // ── Mobile touch input ─────────────────────────────────────────────────
    if (this.isMobile) {
      window.addEventListener('resize', () => {
        this._canvasWidth  = canvas.width  || window.innerWidth;
        this._canvasHeight = canvas.height || window.innerHeight;
      });

      // Canvas touch → block-placement (right-click equivalent)
      canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (this._mobilePlaceTouchId === -1) {
            const r = canvas.getBoundingClientRect();
            const scaleX = canvas.width  / r.width;
            const scaleY = canvas.height / r.height;
            this._mobilePlaceTouchId = t.identifier;
            this._mobilePlace        = true;
            this._mobilePlacePos     = {
              x: (t.clientX - r.left) * scaleX,
              y: (t.clientY - r.top)  * scaleY,
            };
          }
        }
      }, { passive: false });

      canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === this._mobilePlaceTouchId) {
            const r = canvas.getBoundingClientRect();
            const scaleX = canvas.width  / r.width;
            const scaleY = canvas.height / r.height;
            this._mobilePlacePos = {
              x: (t.clientX - r.left) * scaleX,
              y: (t.clientY - r.top)  * scaleY,
            };
          }
        }
      }, { passive: false });

      canvas.addEventListener('touchend', e => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === this._mobilePlaceTouchId) {
            this._mobilePlaceTouchId = -1;
            this._mobilePlace        = false;
          }
        }
      }, { passive: false });

      canvas.addEventListener('touchcancel', e => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === this._mobilePlaceTouchId) {
            this._mobilePlaceTouchId = -1;
            this._mobilePlace        = false;
          }
        }
      }, { passive: false });

      // Bind joystick elements – try immediately and also after DOMContentLoaded
      const bindAll = (): void => {
        this._bindJoystick('mobile-left-joystick',  'mobile-left-knob',  this._leftStick);
        this._bindJoystick('mobile-right-joystick', 'mobile-right-knob', this._rightStick);
      };
      bindAll();
      document.addEventListener('DOMContentLoaded', bindAll);
    }
  }

  /** Attach touch listeners to a joystick DOM element. */
  private _bindJoystick(baseId: string, knobId: string, state: JoystickState): void {
    const base = document.getElementById(baseId);
    const knob = document.getElementById(knobId);
    if (!base) return;

    const updateStick = (clientX: number, clientY: number): void => {
      const rect  = base.getBoundingClientRect();
      const cx    = rect.left + rect.width  / 2;
      const cy    = rect.top  + rect.height / 2;
      const rawDx = clientX - cx;
      const rawDy = clientY - cy;
      const dist  = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
      const clamp = Math.min(dist, JOYSTICK_RADIUS_PX);
      const ang   = Math.atan2(rawDy, rawDx);
      state.dx    = clamp * Math.cos(ang) / JOYSTICK_RADIUS_PX;
      state.dy    = clamp * Math.sin(ang) / JOYSTICK_RADIUS_PX;
      if (knob) {
        knob.style.transform = `translate(${clamp * Math.cos(ang)}px, ${clamp * Math.sin(ang)}px)`;
      }
    };

    const resetStick = (): void => {
      state.active  = false;
      state.touchId = -1;
      state.dx      = 0;
      state.dy      = 0;
      if (knob) knob.style.transform = '';
    };

    base.addEventListener('touchstart', e => {
      e.stopPropagation();
      e.preventDefault();
      if (state.touchId !== -1) return;
      const t       = e.changedTouches[0];
      state.touchId = t.identifier;
      state.active  = true;
      updateStick(t.clientX, t.clientY);
    }, { passive: false });

    base.addEventListener('touchmove', e => {
      e.stopPropagation();
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === state.touchId) { updateStick(t.clientX, t.clientY); break; }
      }
    }, { passive: false });

    base.addEventListener('touchend', e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === state.touchId) { resetStick(); break; }
      }
    }, { passive: false });

    base.addEventListener('touchcancel', e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === state.touchId) { resetStick(); break; }
      }
    }, { passive: false });
  }

  isDown(key: string): boolean {
    if (this.keys.has(key.toLowerCase())) return true;
    if (this.isMobile) {
      const k   = key.toLowerCase();
      const mag = Math.sqrt(this._leftStick.dx ** 2 + this._leftStick.dy ** 2);
      if (mag > JOYSTICK_DEADZONE) {
        if (k === 'w' && this._leftStick.dy < -JOYSTICK_DEADZONE) return true;
        if (k === 's' && this._leftStick.dy >  JOYSTICK_DEADZONE) return true;
        if (k === 'a' && this._leftStick.dx < -JOYSTICK_DEADZONE) return true;
        if (k === 'd' && this._leftStick.dx >  JOYSTICK_DEADZONE) return true;
      }
    }
    return false;
  }

  get mousePos(): Vec2 {
    if (this.isMobile) {
      // Block-placement drag takes priority over aim pos
      if (this._mobilePlace) return this._mobilePlacePos;
      // Right stick provides a virtual aim position offset from canvas centre
      const mag = Math.sqrt(this._rightStick.dx ** 2 + this._rightStick.dy ** 2);
      if (mag > JOYSTICK_DEADZONE) {
        return {
          x: this._canvasWidth  / 2 + this._rightStick.dx * AIM_OFFSET_PX,
          y: this._canvasHeight / 2 + this._rightStick.dy * AIM_OFFSET_PX,
        };
      }
    }
    return this.mouse;
  }

  get mouseDown(): boolean {
    if (this._mouseDown) return true;
    if (this.isMobile) {
      const mag = Math.sqrt(this._rightStick.dx ** 2 + this._rightStick.dy ** 2);
      return this._rightStick.active && mag > RIGHT_STICK_FIRE_THR;
    }
    return false;
  }

  get mouseRightDown(): boolean {
    return this._mouseRightDown || (this.isMobile && this._mobilePlace);
  }

  /** Consume accumulated scroll delta (resets to 0 after reading). */
  consumeScroll(): number {
    const d = this._scrollDelta;
    this._scrollDelta = 0;
    return d;
  }
}
