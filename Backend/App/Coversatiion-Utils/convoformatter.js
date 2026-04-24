 function formatConversationHistory(history) {
  if (!Array.isArray(history) || !history.length) {
    return "No prior conversation.";
  }

  return history
    .map(
      (turn, index) =>
        `Turn ${index + 1}\nUser: ${turn.user}\nAssistant: ${turn.ai}`,
    )
    .join("\n\n");
}
module.exports={
    formatConversationHistory
}