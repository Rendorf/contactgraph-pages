export function celebrationAddressGuidance(language, interactionType, hasTemplate = false) {
  const addressForm = typeof interactionType === "string"
    ? interactionType.trim().replace(/^Address:\s*/i, "").trim().toLocaleLowerCase("az")
    : "";

  if (addressForm === "sən") {
    if (language === "Russian") return "Use informal singular Russian ты/тебя/тебе and matching singular verb forms throughout. Do not switch to Вы/Вас/Вам, even if the reference template is formal.";
    if (language === "Azerbaijani") return "Use informal Azerbaijani sən/səni/sənə and matching verb forms throughout, even if the reference template is formal.";
    return "Use a warm, informal form of address without inventing a close relationship.";
  }

  if (addressForm === "siz") {
    if (language === "Russian") return "Use formal Russian Вы/Вас/Вам and matching plural verb forms throughout. Do not switch to ты/тебя/тебе, even if the reference template is informal.";
    if (language === "Azerbaijani") return "Use formal Azerbaijani Siz/Sizi/Sizə and matching verb forms throughout, even if the reference template is informal.";
    return "Use a respectful, formal form of address without inventing a title or relationship.";
  }

  return hasTemplate
    ? "No saved formal/informal preference. Keep the reference template's form of address or use neutral respectful wording; do not infer familiarity."
    : "No saved formal/informal preference. Use neutral respectful wording; do not infer familiarity.";
}
