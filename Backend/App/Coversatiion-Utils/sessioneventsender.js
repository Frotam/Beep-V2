function sendSessionEvent(session, type, payload = {}) {
  if (!session?.ws || session.ws.readyState !== 1) {
    return;
  }

  try {
    session.ws.send(
      JSON.stringify({
        type,
        sessionId: session.sessionId,
        ...payload,
      }),
    );
  } catch (error) {
    console.error("WebSocket send error:", error.message);
  }
}
module.exports={
    sendSessionEvent
}