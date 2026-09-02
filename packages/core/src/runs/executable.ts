import type { ExecutableAction, ImageTransform, ProposedAction } from "@apprentice/schemas";
import { mapImageToDisplay } from "../geometry/index.js";

/** Maps a validated proposal to display coordinates. Control actions (done/fail/ask_user) are not executable. */
export function toExecutableAction(action: ProposedAction, transform: ImageTransform): ExecutableAction {
  switch (action.type) {
    case "click": {
      const point = mapImageToDisplay({ x: action.x, y: action.y }, transform);
      return { type: "click", x: point.x, y: point.y, button: action.button };
    }
    case "double_click": {
      const point = mapImageToDisplay({ x: action.x, y: action.y }, transform);
      return { type: "double_click", x: point.x, y: point.y };
    }
    case "move": {
      const point = mapImageToDisplay({ x: action.x, y: action.y }, transform);
      return { type: "move", x: point.x, y: point.y };
    }
    case "scroll": {
      const point = mapImageToDisplay({ x: action.x, y: action.y }, transform);
      return { type: "scroll", x: point.x, y: point.y, deltaX: action.deltaX, deltaY: action.deltaY };
    }
    case "type_text":
      return { type: "type_text", text: action.text };
    case "press_key":
      return { type: "press_key", key: action.key };
    case "hotkey":
      return { type: "hotkey", modifiers: [...action.modifiers], key: action.key };
    case "wait":
      return { type: "wait", ms: action.ms };
    case "ask_user":
    case "done":
    case "fail":
      throw new Error(`toExecutableAction: ${action.type} is a control action, not an executable one`);
  }
}
