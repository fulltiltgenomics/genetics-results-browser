// whether the chat options panel shows the Tools row (the Code execution switch), set per
// deployment at build time via VITE_SHOW_TOOLS_CONTROL. Only the literal "false" hides it, so
// an unconfigured build keeps the control; a deployment that hides it decides the surface for
// its users through DEFAULT_TOOL_PROFILE on chat-backend instead, and a user's stored choice
// still applies — there is just no control left to change it with
export const SHOW_TOOLS_CONTROL = import.meta.env.VITE_SHOW_TOOLS_CONTROL !== "false";
