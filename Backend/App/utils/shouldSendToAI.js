function shouldSendToAI(text, session) {

  if (!text) return false;

  const cleaned =
    text
      .trim()
      .toLowerCase();


  // ignore empty
  if (!cleaned.length)
    return false;


  // ignore very tiny noise
  if (cleaned.length === 1)
    return false;


  // common noise / filler sounds
  const ignoreList = [

    "uh",
    "um",
    "hmm",
    "huh",
    "ah",
    "mmm",
    "aaa",
    "eh",

    "you you",
    "ha ha",

  ];


  if (ignoreList.includes(cleaned))
    return false;



  // allow meaningful short commands
  const allowedShortWords = [

    "hi",
    "hello",
    "hey",
    "menu",
    "price",
    "yes",
    "no",
    "thanks",
    "thank you",
    "veg",
    "food",
    "order"

  ];


  if (allowedShortWords.includes(cleaned))
    return true;



  // avoid repeated same transcript
  if (
    cleaned === session.lastFinalTranscript
  )
    return false;


  session.lastFinalTranscript =
    cleaned;


  return true;

}
function isVague(text) {

  const vaguePatterns = [

    "earlier",
    "previous",
    "that",
    "same",
    "repeat",
    "again",
    "what i said"

  ];

  const t = text.toLowerCase();

  return vaguePatterns.some(p => t.includes(p));

}
module.exports={
    shouldSendToAI,
    isVague
}