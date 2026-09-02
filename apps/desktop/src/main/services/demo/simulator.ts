import type { ExecutableAction, OcrBlock } from "@apprentice/schemas";
import type { MockRunStep } from "../../../../../../packages/test-fixtures/src/skills.js";
import type { TemplateName } from "../../../../../../packages/test-fixtures/src/types.js";
import { FixtureScreenSource, type ScreenCapture, type ScreenSource } from "../observation/screen-source.js";
import type { Actuator, RunContextSnapshot } from "../runs/types.js";
import { DEMO_SCREEN_STATES, type DemoScreenState } from "./screen-states.js";

export interface TemplateTarget {
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

export interface DemoSimulatorOptions {
  readonly readPng: (name: string) => Buffer;
  readonly targets: Readonly<Record<string, TemplateTarget>>;
  readonly now?: () => number;
}

const CLICK_TOLERANCE_PX = 30;
const OCR_ROW_HEIGHT = 22;

function effectOf(action: ExecutableAction, label: string): string {
  switch (action.type) {
    case "type_text":
      return action.text.slice(0, 80);
    case "press_key":
      return action.key === "pagedown" || action.key === "pageup" || action.key === "down" || action.key === "up" ? "Scrolled to the next section" : `${action.key} pressed`;
    case "hotkey":
      return `${action.modifiers.join("+")}+${action.key} applied`;
    case "scroll":
      return "Scrolled";
    case "click":
    case "double_click":
      return `${label} selected`;
    case "move":
    case "wait":
      return "";
  }
}

function isActionStep(step: MockRunStep): boolean {
  return step.action === "click" || step.action === "type_text" || step.action === "press_key";
}

/**
 * Fixture screen simulator for demo runs: holds the current template, advances
 * to the next template when an approved action matches the timeline, and
 * exposes deterministic OCR and context for that screen.
 */
export class DemoScreenSimulator implements ScreenSource {
  private readonly source: FixtureScreenSource;
  private timeline: readonly MockRunStep[] = [];
  private pointer = 0;
  /** Visible effects of actions that did not change the template (typed text, scroll, selection). */
  private effects: readonly string[] = [];
  readonly performed: ExecutableAction[] = [];

  constructor(private readonly options: DemoSimulatorOptions) {
    this.source = new FixtureScreenSource({ readPng: options.readPng, initial: "genericBlank", now: options.now });
  }

  get template(): TemplateName {
    return this.source.template as TemplateName;
  }

  state(): DemoScreenState {
    return DEMO_SCREEN_STATES[this.template];
  }

  setTemplate(name: TemplateName): void {
    if (name !== this.template) this.effects = [];
    this.source.setTemplate(name);
  }

  /** Installs the execution timeline for a run and shows its first screen. */
  loadTimeline(timeline: readonly MockRunStep[]): void {
    this.timeline = timeline;
    this.pointer = 0;
    this.effects = [];
    const first = timeline[0];
    if (first) this.source.setTemplate(first.templateName);
  }

  /** The run moved on: show the first screen of that subtask's timeline entries. */
  advanceToSubtask(index: number): void {
    const at = this.timeline.findIndex((step) => step.subtaskIndex === index);
    if (at < 0) return;
    this.pointer = at;
    this.setTemplate(this.timeline[at]!.templateName);
  }

  captureFrontmost(): Promise<ScreenCapture> {
    return this.source.captureFrontmost();
  }

  target(): TemplateTarget {
    const target = this.options.targets[this.template];
    if (!target) throw new Error(`No target for template ${this.template}`);
    return target;
  }

  context(): RunContextSnapshot {
    const state = this.state();
    return {
      bundleId: state.bundleId,
      appName: state.appName,
      windowTitle: state.windowTitle,
      isSecureInput: false,
      domain: state.domain,
      path: state.path,
      domMarkers: [...state.domMarkers]
    };
  }

  /** OCR blocks for the current screen scaled into an image of `width` x `height` pixels. */
  ocrBlocks(width: number, height: number): OcrBlock[] {
    const state = this.state();
    const target = this.target();
    const capture = this.source.captureFrontmost();
    void capture;
    const original = this.originalSize();
    const sx = width / original.width;
    const sy = height / original.height;
    const labelWidth = Math.max(40, target.label.length * 9);
    const blocks: OcrBlock[] = [
      { text: target.label, x: (target.x - labelWidth / 2) * sx, y: (target.y - 11) * sy, width: labelWidth * sx, height: OCR_ROW_HEIGHT * sy, confidence: 0.98 }
    ];
    const words = [...state.words.filter((word) => word !== target.label), ...this.effects];
    words.forEach((word, index) => {
      const x = 24;
      const y = 24 + index * (OCR_ROW_HEIGHT + 6);
      const w = Math.max(40, word.length * 9);
      const farFromTarget = Math.hypot(x + w / 2 - target.x, y + OCR_ROW_HEIGHT / 2 - target.y) > 120;
      const finalY = farFromTarget ? y : original.height - 40 - index * (OCR_ROW_HEIGHT + 6);
      blocks.push({ text: word, x: x * sx, y: finalY * sy, width: w * sx, height: OCR_ROW_HEIGHT * sy, confidence: 0.95 });
    });
    return blocks;
  }

  private originalSize(): { width: number; height: number } {
    const png = this.options.readPng(this.template);
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  }

  private nextActionIndex(): number {
    let index = this.pointer;
    while (index < this.timeline.length && !isActionStep(this.timeline[index]!)) index += 1;
    return index;
  }

  private matches(step: MockRunStep, action: ExecutableAction): boolean {
    if (step.action === "click") {
      if (action.type !== "click" && action.type !== "double_click") return false;
      const target = this.options.targets[step.templateName];
      if (!target) return false;
      return Math.hypot(action.x - target.x, action.y - target.y) <= CLICK_TOLERANCE_PX;
    }
    if (step.action === "type_text") return action.type === "type_text" && action.text === step.text;
    if (step.action === "press_key") return action.type === "press_key" && action.key.toLowerCase() === (step.key ?? "").toLowerCase();
    return false;
  }

  /**
   * Applies an executed action: advances the timeline when it matches the
   * expected step. When the next screen is the same template, the action's
   * visible effect (typed text, selection, scroll) is added to the OCR so
   * before/after verification sees the same kind of change a real screen shows.
   */
  apply(action: ExecutableAction): boolean {
    this.performed.push(action);
    const index = this.nextActionIndex();
    const expected = this.timeline[index];
    if (!expected || expected.templateName !== this.template || !this.matches(expected, action)) return false;
    this.pointer = index + 1;
    const next = this.timeline[this.pointer];
    const nextTemplate = next?.templateName ?? this.template;
    if (nextTemplate !== this.template) {
      this.setTemplate(nextTemplate);
      return true;
    }
    this.effects = [...this.effects, effectOf(action, this.target().label)].slice(-6);
    return true;
  }
}

/** Actuator that mutates the fixture simulator instead of the real desktop. */
export class DemoActuator implements Actuator {
  constructor(private readonly simulator: DemoScreenSimulator) {}

  async perform(action: ExecutableAction, approvalToken: string): Promise<{ performed: boolean; durationMs: number }> {
    if (approvalToken.length < 8) throw new Error("approval token missing");
    this.simulator.apply(action);
    return { performed: true, durationMs: 0 };
  }
}
