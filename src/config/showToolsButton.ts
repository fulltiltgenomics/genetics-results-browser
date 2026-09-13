// whether the chat header shows the Tools button (the list of what the assistant can call), set
// per deployment at build time via VITE_SHOW_TOOLS_BUTTON. Only the literal "false" hides it, so
// an unconfigured build keeps the button. Independent of SHOW_TOOLS_CONTROL: that one governs
// the Code execution switch in the options panel, this one only an informational dialog
export const SHOW_TOOLS_BUTTON = import.meta.env.VITE_SHOW_TOOLS_BUTTON !== "false";
