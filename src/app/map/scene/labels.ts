export type LabelKind = "plain" | "strong" | "faint" | "special";

/** What every label shares, as Tailwind classes. Only its place is set per frame. */
const LABEL =
  "absolute top-0 left-0 font-sans text-xs/none whitespace-nowrap will-change-transform text-shadow-[0_0_4px_#000,0_0_2px_#000]";

/** A label of each kind: the shared classes plus its colour and weight. */
const KINDS: Record<LabelKind, string> = {
  plain: `${LABEL} font-medium text-foreground/85`,
  strong: `${LABEL} font-semibold text-white`,
  faint: `${LABEL} font-medium text-[#aab2c8]/70`,
  special: `${LABEL} font-semibold text-[#ff9ccf]`,
};

/**
 * Names next to stars and planets. They are ordinary HTML elements on top of
 * the canvas: text stays sharp and needs no font inside WebGL. The elements
 * are reused from frame to frame.
 */
export class LabelLayer {
  private readonly root: HTMLDivElement;
  private readonly labels: HTMLDivElement[] = [];
  private readonly ring: HTMLDivElement;
  private used = 0;
  private ringUsed = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.setAttribute("aria-hidden", "true");
    this.root.className = "pointer-events-none absolute inset-0 overflow-hidden";
    this.ring = document.createElement("div");
    this.ring.className =
      "absolute top-0 left-0 rounded-full border-[1.5px] border-accent/95 shadow-[0_0_8px] shadow-accent/60";
    this.ring.hidden = true;
    this.root.append(this.ring);
    container.append(this.root);
  }

  /** Call before the labels of a frame are placed. */
  begin(): void {
    this.used = 0;
    this.ringUsed = false;
  }

  /** A name to the right of the point (x, y), in CSS pixels. `gap` keeps it clear of the object. */
  put(text: string, x: number, y: number, kind: LabelKind = "plain", gap = 9): void {
    let label = this.labels[this.used];
    if (!label) {
      label = document.createElement("div");
      this.labels.push(label);
      this.root.append(label);
    }
    if (label.textContent !== text) label.textContent = text;
    if (label.className !== KINDS[kind]) label.className = KINDS[kind];
    label.hidden = false;
    // The place changes with every frame, so it is the one value set as a style.
    label.style.transform = `translate(${Math.round(x + gap)}px, ${Math.round(y - 6)}px)`;
    this.used++;
  }

  /** A circle around the selected object. */
  mark(x: number, y: number, radius: number): void {
    const size = radius * 2;
    this.ring.hidden = false;
    this.ring.style.width = `${size}px`;
    this.ring.style.height = `${size}px`;
    this.ring.style.transform = `translate(${x - radius}px, ${y - radius}px)`;
    this.ringUsed = true;
  }

  /** Call after the labels of a frame are placed: hides the ones not used this time. */
  end(): void {
    for (let i = this.used; i < this.labels.length; i++) this.labels[i].hidden = true;
    if (!this.ringUsed) this.ring.hidden = true;
  }

  dispose(): void {
    this.root.remove();
  }
}
