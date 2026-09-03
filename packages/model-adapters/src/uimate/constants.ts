/**
 * Ported from Tencent/UI-Mate agents/ui_mate_agent.py at commit 1cb9e1e, Apache-2.0.
 *
 * Reference evaluation defaults and the prompt fragments that are fixed by the
 * checkpoint. Every string below is copied verbatim from the vendored source
 * (third_party/ui-mate) so that the assembled prompt is byte-identical to the
 * official one; only non-ASCII punctuation is written as an escape sequence.
 */

export const DEFAULT_MODEL = "UI_Mate";
export const DEFAULT_PLATFORM = "ubuntu";
export const DEFAULT_ACTION_SPACE = "pyautogui";
export const DEFAULT_OBSERVATION_TYPE = "screenshot";

export const DEFAULT_MAX_TOKENS = 16384;
export const DEFAULT_TEMPERATURE = 1.0;
export const DEFAULT_TOP_P = 0.95;

export const DEFAULT_HISTORY_N = 100;
export const DEFAULT_IMAGES_TO_KEEP = 5;
export const DEFAULT_COORDINATE_TYPE = "relative";
export const DEFAULT_INCLUDE_THINKING_IN_HISTORY = true;
export const DEFAULT_RECENT_THINK_STEPS: number | null = null;
export const DEFAULT_ENABLE_THINKING = true;

export const DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1";
export const DEFAULT_API_KEY = "EMPTY";
export const DEFAULT_REQUEST_TIMEOUT_MS = 130000;
export const DEFAULT_MAX_RETRY_TIMES = 2;

export const COLLAPSED_SCREENSHOT_TEXT = "This screenshot has been collapsed.";

/** Model coordinates are expressed on a 0-999 grid regardless of image size. */
export const COORDINATE_SCALE = 999.0;

export type CoordinateType = "relative" | "absolute";

/** Image preprocessing constants (process_image / smart_resize defaults). */
export const SMART_RESIZE_DEFAULT_FACTOR = 28;
export const SMART_RESIZE_DEFAULT_MIN_PIXELS = 56 * 56;
export const SMART_RESIZE_DEFAULT_MAX_PIXELS = 14 * 14 * 4 * 1280;
export const SMART_RESIZE_DEFAULT_MAX_LONG_SIDE = 8192;
export const PROCESS_IMAGE_FACTOR = 32;
export const PROCESS_IMAGE_MAX_PIXELS = 16 * 16 * 4 * 12800;

export const PROMPT_ADDITIONS = `<IMPORTANT_NOTES>
* DO NOT use LibreOffice macros or GIMP Script-Fu to complete tasks. Always use the GUI interface directly with mouse and keyboard actions. Macros and scripting cause reliability issues and task failures.
* For GIMP tasks, do NOT save or export files unless the instruction explicitly asks you to. Note that existing tasks that require file output will ask you to "export", not "save". Most GIMP tasks are evaluated automatically without requiring you to save.
* Before starting a task, consider whether it is achievable with the designated application's native GUI features. If the app fundamentally lacks the requested capability, declare it infeasible (finish with status=failure) instead of using CLI tools, Python scripts, or other applications as workarounds.
* After completing a task, verify the visible or functional result. If your actions had no real effect, reconsider whether the task is feasible.
</IMPORTANT_NOTES>`;

/** Platform the assembled prompt targets; "ubuntu" reproduces the official text. */
export type PromptPlatform = "ubuntu" | "macos";

/** Index of the "no terminal, click desktop icons" line inside DESCRIPTION_PROMPT_LINES. */
export const MACOS_ENVIRONMENT_LINE_INDEX = 1;

/** Lines of build_description_prompt(), joined with "\n". */
export const DESCRIPTION_PROMPT_LINES: readonly string[] = [
  "Use a mouse and keyboard to interact with a computer, and take screenshots.",
  "* This is an interface to a desktop GUI. You do not have access to a terminal" +
    " or applications menu. You must click on desktop icons to start applications.",
  "* Some applications may take time to start or process actions, so you may need" +
    " to wait and take successive screenshots to see the results of your actions." +
    " E.g. if you click on Firefox and a window doesn't open, try wait and taking" +
    " another screenshot.",
  "* The screen's resolution is 1000x1000.",
  "* Whenever you intend to move the cursor to click on an element like an icon," +
    " you should consult a screenshot to determine the coordinates of the element" +
    " before moving the cursor.",
  "* If you tried clicking on a program or link but it failed to load even after" +
    " waiting, try adjusting your cursor position so that the tip of the cursor" +
    " visually falls on the element that you want to click.",
  "* Make sure to click any buttons, links, icons, etc with the cursor tip in the" +
    " center of the element. Don't click boxes on their edges unless asked."
];

/**
 * Apprentice deviation (documented in README.md): the official notes above are
 * written for the OSWorld Ubuntu environment. Apprentice only ever drives
 * macOS, so a macOS variant is used whenever `platform` is "macos"; the Ubuntu
 * text stays byte-identical for the golden prompt tests.
 */
export const PROMPT_ADDITIONS_MACOS = `<IMPORTANT_NOTES>
* Always drive the application's GUI directly with mouse and keyboard actions. Do NOT use AppleScript, Automator, shell commands or application macros to complete tasks. Scripting causes reliability issues and task failures.
* The target application is already open and frontmost. Do not switch to another application, and do not open a new one, unless the instruction explicitly asks for it.
* macOS shortcuts use Command, not Control: cmd+c, cmd+v, cmd+s, cmd+f. The menu bar at the top of the screen belongs to the frontmost application, and the Dock sits at the edge of the screen.
* Before starting a task, consider whether it is achievable with the designated application's native GUI features. If the app fundamentally lacks the requested capability, declare it infeasible (finish with status=failure) instead of using Terminal, scripts, or other applications as workarounds.
* After completing a task, verify the visible or functional result. If your actions had no real effect, reconsider whether the task is feasible.
</IMPORTANT_NOTES>`;

/** macOS variant of DESCRIPTION_PROMPT_LINES: only the environment line differs. */
export const DESCRIPTION_PROMPT_LINES_MACOS: readonly string[] = DESCRIPTION_PROMPT_LINES.map((line, index) =>
  index === MACOS_ENVIRONMENT_LINE_INDEX
    ? "* This is an interface to a macOS desktop GUI. You do not have access to a" +
      " terminal. The application you must work in is already open and frontmost;" +
      " use its windows, the menu bar at the top of the screen, the Dock and Finder," +
      " and do not switch to another application unless the instruction says so."
    : line
);

export const ACTION_DESCRIPTION = `* \`left_click\`: Click the left mouse button at the specified (x, y) coordinate.
* \`right_click\`: Click the right mouse button at the specified (x, y) coordinate.
* \`middle_click\`: Click the middle mouse button at the specified (x, y) coordinate.
* \`double_click\`: Double-click the left mouse button at the specified (x, y) coordinate.
* \`triple_click\`: Triple-click the left mouse button at a specified (x, y) coordinate.
* \`drag\`: Click and drag the mouse cursor from its current position to the specified (x, y) coordinate.
* \`mouse_move\`: Move the cursor to the specified (x, y) coordinate without clicking.
* \`type\`: Type a specified string of text.
* \`hotkey\`: Press a combination of keys (e.g., ["ctrl", "v"]).
* \`press\`: Press a single key or a sequence of keys, provided as an array of strings (e.g., ["backspace"], ["enter"], ["a", "b", "c"]).
* \`key_down\`: Press and HOLD the specified key(s) down in order (no release). Use this for stateful holds like holding Shift while clicking.
* \`key_up\`: Release the specified key(s) in reverse order.
* \`scroll\`: Scroll the mouse wheel by a specified number of pixels. Use "direction" to specify vertical (default, positive for up, negative for down) or horizontal (positive for right, negative for left) scrolling.
* \`wait\`: Pause execution for a specified number of seconds.
* \`call_user\`: Ask the user for information or confirmation. Use this when you genuinely need user input, or when the task cannot be completed (in that case clearly state why it is infeasible).
* \`finished\`: Terminate the task and indicate whether it was a 'success' or 'failure'.`;

export const ACTION_ENUM: readonly string[] = [
  "left_click", "right_click", "middle_click",
  "double_click", "triple_click", "drag", "mouse_move",
  "type", "hotkey", "press", "key_down", "key_up",
  "scroll", "wait", "call_user", "finished"
];

export const TOOLS_BLOCK_HEADER = "# Tools\n\nYou have access to the following functions:\n\n<tools>\n";

export const TOOLS_BLOCK_FOOTER =
  "\n</tools>\n\n" +
  "If you choose to call a function ONLY reply in the following format with NO suffix:\n\n" +
  "<tool_call>\n" +
  "<function=example_function_name>\n" +
  "<parameter=example_parameter_1>\n" +
  "value_1\n" +
  "</parameter>\n" +
  "<parameter=example_parameter_2>\n" +
  "This is the value for the second parameter\n" +
  "that can span\n" +
  "multiple lines\n" +
  "</parameter>\n" +
  "</function>\n" +
  "</tool_call>\n\n" +
  "<IMPORTANT>\n" +
  "Reminder:\n" +
  "- Function calls MUST follow the specified format: an inner" +
  " <function=...></function> block must be nested within" +
  " <tool_call></tool_call> XML tags\n" +
  "- Required parameters MUST be specified\n" +
  "- You may provide optional reasoning for your function call in natural" +
  " language BEFORE the function call, but NOT after\n" +
  "- If there is no function call available, answer the question like normal" +
  " with your current knowledge and do not tell the user about function calls\n" +
  "</IMPORTANT>";

export const RESPONSE_FORMAT =
  "Response format for every step:\n" +
  "1) Thought: A single <think>...</think> block containing step by step progress" +
  " assessment and next action analysis.\n" +
  "2) Action: A single <action>...</action> block containing a short imperative describing what to do in the UI.\n" +
  "3) Tool Execution: A single or multiple <tool_call>...</tool_call> blocks.\n\n" +
  "Rules:\n" +
  "- Output exactly in the order: <think>...</think>, <action>...</action>, <tool_call>...</tool_call>.\n" +
  "- From a first-person perspective, systematically assess progress and errors," +
  " evaluate potential next steps, and precisely plan text inputs" +
  " (cursor position and expected outcomes)\n" +
  "- Be brief for Action: one sentence for action description.\n" +
  "- Do not output anything else outside those parts.\n" +
  "- If finishing, use action=finished in the tool call. If the task is infeasible, finish with status=failure.";

export const SYSTEM_PROMPT_PREAMBLE = "You are a helpful GUI agent.\n\n";
export const RESPONSE_FORMAT_HEADER = "# Response format\n\n";

/** Literals of the give-up heuristic (looks_infeasible_response). */
export const INFEASIBLE_LITERALS: readonly string[] = [
  "not possible", "impossible", "not feasible", "cannot be completed",
  "can't be completed", "cannot be done", "cannot complete", "can't complete",
  "unable to complete", "cannot do this task", "can't do this task",
  "cannot complete this task as described", "cannot be completed as specified",
  "can't be completed as specified", "not available in your country", "not available",
  "unavailable", "not supported", "does not support", "doesn't support",
  "cannot natively", "does not have a built-in", "doesn't have a built-in",
  "does not include", "is not among the natively built-in", "will fall back to english",
  "requires the official", "no bluetooth found", "plug in a dongle", "folder is empty",
  "downloads folder is empty", "do not have the credentials", "don't have the credentials",
  "do not have the account credentials", "don't have the account credentials",
  "need the user's google account credentials", "requires a language pack extension",
  "requires email verification", "requires a sign-up", "requires sign-up",
  "requires google account credentials", "requires a google account",
  "sign in to the google account", "drm-protected", "drm protection",
  "cannot directly play", "no legitimate way", "requires a plugin", "requires an extension",
  "requires extension", "requires plugin", "requires a valid account", "requires purchase",
  "requires a purchased", "no valid account", "hidden audio", "could you clarify"
];

export const INFEASIBLE_REGEXES: readonly RegExp[] = [
  /\bthere is no [a-z0-9 _-]+\b/,
  /\bno [a-z0-9 _-]+ in [a-z0-9 _-]+ list\b/,
  /\brequires? (an? )?(extension|plugin|account|credentials|hardware|language pack)\b/,
  /\bneed(?:s)? (an? )?(extension|plugin|account|credentials|hardware|language pack)\b/,
  /\b(without|no) (extensions?|plugins?|terminal|ffmpeg|other apps?).{0,120}\b(cannot|can't|not possible|not feasible)\b/s
];

export const CONTROL_TOKENS = ["WAIT", "DONE", "FAIL"] as const;
export type UIMateControlToken = (typeof CONTROL_TOKENS)[number];
